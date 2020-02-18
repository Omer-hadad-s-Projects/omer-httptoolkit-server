declare module 'adbkit' {
    import * as stream from 'stream';
    import * as events from 'events';

    export interface Device {
        id: string;
        type: string;
    }

    export interface File {
        name: string;
    }

    export interface AdbClient {
        listDevices(): Promise<Device[]>;
        isInstalled(id: string, pkg: string): Promise<boolean>;
        install(id: string, apk: string | stream.Readable): Promise<true>;
        startActivity(
            id: string,
            options: {
                debug?: boolean;
                wait?: boolean;
                action?: string;
                data?: string;
            }
        ): Promise<true>;
        readdir(id: string, path: string): Promise<Array<File>>;
        push(
            id: string,
            contents: string | stream.Readable,
            path: string,
            mode?: number
        ): Promise<events.EventEmitter>;
        pull(
            id: string,
            path: string
        ): Promise<events.EventEmitter & { cancel: () => void }>
        shell(id: string, cmd: string | string[]): Promise<stream.Readable>;
        root(id: string): Promise<true>;
    }

    export function createClient(options?: {
        port?: number,
        host?: string,
        bin?: string
    }): AdbClient;

    export namespace util {
        export function readAll(stream: stream.Readable): Promise<Buffer>;
    }
}