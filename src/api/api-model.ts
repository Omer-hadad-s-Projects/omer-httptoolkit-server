import * as _ from 'lodash';
import * as os from 'os';

import { generateSPKIFingerprint } from 'mockttp';
import { getSystemProxy } from 'os-proxy-config';

import { SERVER_VERSION } from "../constants";
import { delay } from '../util/promise';
import { reportError, addBreadcrumb } from '../error-tracking';
import { HtkConfig } from "../config";
import { ActivationError, Interceptor } from "../interceptors";
import { getDnsServer } from '../dns-server';

const INTERCEPTOR_TIMEOUT = 1000;

export class ApiModel {

    constructor(
        private config: HtkConfig,
        private interceptors: _.Dictionary<Interceptor>,
        private getRuleParamKeys: () => string[],
        private callbacks: {
            onTriggerUpdate: () => void,
            onTriggerShutdown: () => void
        }
    ) {}

    getVersion() {
        return SERVER_VERSION;
    }

    updateServer() {
        this.callbacks.onTriggerUpdate();
    }

    // On Windows, there's no clean way to send signals between processes to trigger graceful
    // shutdown. To handle that, we use HTTP from the desktop shell, instead of inter-process
    // signals. This completely shuts down the server, not just a single proxy endpoint, and
    // should only be called once the app is fully exiting.
    shutdownServer() {
        this.callbacks.onTriggerShutdown();
    }

    async getConfig(proxyPort?: number) {
        return {
            certificatePath: this.config.https.certPath,
            certificateContent: this.config.https.certContent,

            // We could calculate this client side, but it  requires node-forge or some
            // other heavyweight crypto lib, and we already have that here, so it's
            // convenient to do it up front.
            certificateFingerprint: generateSPKIFingerprint(this.config.https.certContent),

            networkInterfaces: os.networkInterfaces(),
            systemProxy: await withFallback(() => getSystemProxy(), 2000, undefined),

            dnsServers: proxyPort
                ? await this.getDnsServers(proxyPort)
                : [],

            ruleParameterKeys: this.getRuleParamKeys()
        };
    }

    // Seperate purely to support the GQL API resolver structure
    getDnsServers(proxyPort: number) {
        return withFallback(async () => {
            const dnsServer = await getDnsServer(proxyPort);
            return [`127.0.0.1:${dnsServer.address().port}`];
        }, 2000, []);
    }

    getInterceptors(proxyPort?: number) {
        return Promise.all(
            Object.keys(this.interceptors).map((key) => {
                return this.getInterceptor(key, { metadataType: 'summary', proxyPort });
            })
        );
    }

    async getInterceptor(id: string, options: {
        metadataType?: 'summary' | 'detailed',
        proxyPort?: number
    } = {}) {
        const interceptor = this.interceptors[id];

        return {
            id: interceptor.id,
            version: interceptor.version,
            metadata: options.metadataType
                ? this.getInterceptorMetadata(id, options.metadataType)
                : undefined,
            isActivable: await withFallback(
                async () => interceptor.isActivable(),
                interceptor.activableTimeout || INTERCEPTOR_TIMEOUT,
                false
            ),
            isActive: options.proxyPort
                ? await this.isInterceptorActive(id, options.proxyPort)
                : undefined
        };
    }

    // Seperate purely to support the GQL API resolver structure
    async isInterceptorActive(id: string, proxyPort: number) {
        const interceptor = this.interceptors[id];

        return await withFallback(
            async () => proxyPort
                ? interceptor.isActive(proxyPort)
                : undefined,
            INTERCEPTOR_TIMEOUT,
            false
        );
    }

    // Seperate purely to support the GQL API resolver structure
    async getInterceptorMetadata(id: string, metadataType: 'summary' | 'detailed') {
        const interceptor = this.interceptors[id];
        const metadataTimeout = metadataType === 'summary'
            ? INTERCEPTOR_TIMEOUT
            : INTERCEPTOR_TIMEOUT * 10; // Longer timeout for detailed metadata

        return withFallback(
            async () => interceptor.getMetadata?.(metadataType),
            metadataTimeout,
            undefined
        )
    }

    async activateInterceptor(id: string, proxyPort: number, options: unknown) {
        addBreadcrumb(`Activating ${id}`, { category: 'interceptor', data: { id, options } });

        const interceptor = this.interceptors[id];
        if (!interceptor) throw new Error(`Unknown interceptor ${id}`);

        // After 30s, don't stop activating, but report an error if we're not done yet
        let activationDone = false;
        delay(30000).then(() => {
            if (!activationDone) reportError(`Timeout activating ${id}`)
        });

        try {
            const result = await interceptor.activate(proxyPort, options);
            activationDone = true;
            addBreadcrumb(`Successfully activated ${id}`, { category: 'interceptor' });
            return { success: true, metadata: result };
        } catch (err: any) {
            const activationError = err as ActivationError;
            activationDone = true;
            if (activationError.reportable !== false) {
                addBreadcrumb(`Failed to activate ${id}`, { category: 'interceptor' });
                reportError(err);
            }
            return { success: false, metadata: activationError.metadata };
        }
    }

    async deactivateInterceptor(id: string, proxyPort: number, options: unknown) {
        const interceptor = this.interceptors[id];
        if (!interceptor) throw new Error(`Unknown interceptor ${id}`);

        await interceptor.deactivate(proxyPort, options).catch(reportError);
        return { success: !interceptor.isActive(proxyPort) };
    }

}

// Wait for a promise, falling back to defaultValue on error or timeout
const withFallback = <R>(p: () => Promise<R>, timeoutMs: number, defaultValue: R) =>
    Promise.race([
        p().catch((error) => {
            reportError(error);
            return defaultValue;
        }),
        delay(timeoutMs).then(() => defaultValue)
    ]);