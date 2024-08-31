
import * as _ from 'lodash';
import { delay } from '@httptoolkit/util';
import {
    PluggableAdmin,
    MockttpPluggableAdmin,
    SubscribableEvent,
    MockttpHttpsOptions
} from 'mockttp';

type HtkAdminClient = PluggableAdmin.AdminClient<{ http: MockttpPluggableAdmin.MockttpAdminPlugin }>;

export class Proxy {
    private mockttpRequestBuilder!: MockttpPluggableAdmin.MockttpAdminRequestBuilder;
    private adminClient!: HtkAdminClient

    tlsPassthroughConfig: Array<{ hostname: string }> = [];
    private _currentTlsPassthroughConfig: Array<{ hostname: string }> = [];
    http2Enabled: true | false | 'fallback' = 'fallback';
    private _http2CurrentlyEnabled = this.http2Enabled;

    private config = {
        http: {
            options: {
                cors: false,
                suggestChanges: false,
                http2: this._http2CurrentlyEnabled,
                https: {
                    tlsPassthrough: this._currentTlsPassthroughConfig
                } as MockttpHttpsOptions // Cert/Key options are set by the server
            },
            port: undefined
        },
        webrtc: {}
    }


    constructor() {
        this.adminClient = new PluggableAdmin.AdminClient<{
            http: any,
            webrtc: any
        }>({
            adminServerUrl: 'http://127.0.0.1:45456'
        });

        this._http2CurrentlyEnabled = this.http2Enabled;
        this._currentTlsPassthroughConfig = _.cloneDeep(this.tlsPassthroughConfig);


    }

    public async Start() {
        await startServer(this.adminClient, this.config);
        this.mockttpRequestBuilder = new MockttpPluggableAdmin.MockttpAdminRequestBuilder(
            this.adminClient.schema
        );
    }

    onMockttpEvent = (event: SubscribableEvent, callback: (data: any) => void) => {
        const subRequest = this.mockttpRequestBuilder.buildSubscriptionRequest(event);

        if (!subRequest) {
            console.warn(`Ignoring subscription for event unrecognized by Mockttp client: ${event}`);
            return Promise.resolve();
        }

        return this.adminClient.subscribe(subRequest, callback);
    }


}


function startServer(
    adminClient: HtkAdminClient,
    config: Parameters<HtkAdminClient['start']>[0],
    maxDelay = 500,
    delayMs = 200
): Promise<void> {
     return adminClient.start(config as any).catch((e) => {
    //     console.log('Server initialization failed', e);

    //     if (e.response) {
    //         // Server is listening, but failed to start as requested.
    //         // This generally means that some of our config is bad.

    //         if (e.message?.includes('unrecognized plugin: webrtc')) {
    //             // We have webrtc enabled, and the server is new enough to recognize plugins and try to
    //             // start them, but too old to actually support the WebRTC plugin. Skip that entirely then:
    //             config = {
    //                 ...config,
    //                 webrtc: undefined
    //             };
    //         } else {
    //             // Some other error - probably means that the HTTP port is in use.
    //             // Drop the port config and try again:
    //             config = {
    //                 ...config,
    //                 http: {
    //                     ...config.http,
    //                     port: undefined
    //                 }
    //             }
    //         }

    //         // Retry with our updated config after the tiniest possible delay:
    //         return delay(100).then(() =>
    //             startServer(adminClient, config, maxDelay, delayMs)
    //         );
    //     }

    //     // For anything else (unknown errors, or more likely server not listening yet),
    //     // wait briefly and then retry the same config:
    //     return delay(Math.min(delayMs, maxDelay)).then(() =>
    //         startServer(adminClient, config, maxDelay, delayMs * 1.2)
    //     );
    }) as Promise<void>;
}