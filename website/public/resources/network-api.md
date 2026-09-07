# Network Inspector API

Create with `createNetwork({ cdp })` in execute, or import `NetworkInspector`.
Call `enable()` before reproducing the relevant request. Capture is target-scoped,
opt-in, and bounded (200 entries by default). No bodies are retained automatically.
Query `list()`, inspect one entry with `inspect({ requestId })`, and request a
bounded response excerpt with `responseBody({ requestId, offset, limit })`.
Request IDs are inspector-owned; each redirect hop has its own identity.
Initiator line and column positions are CDP zero-based values. Editor.read uses
a zero-based line offset; Debugger.setBreakpoint uses a one-based line number.

Headers are a redacted CDP view, not a complete wire capture. Arbitrary URLs,
application data, and response bodies can remain sensitive. Body excerpts
preserve CDP encoding; base64 slices are not independently decodable. The
underlying CDP call still transfers the complete body. Unavailable bodies
return an explicit reason rather than a different request's response.

`clear()` forgets entries. `dispose()` releases only this inspector's listeners;
neither disables the shared Network domain or detaches the CDP session.

## Types

```ts
import type { Protocol } from 'devtools-protocol';
import type { ICDPSession } from './cdp-session.js';
export interface NetworkRequestSummary {
    /** Inspector-owned ID, unique for each redirect hop; use this with inspect/responseBody. */
    requestId: string;
    cdpRequestId: string;
    url: string;
    method: string;
    type?: Protocol.Network.ResourceType;
    state: 'pending' | 'complete' | 'failed' | 'redirected';
    status?: number;
    mimeType?: string;
    durationMs?: number;
    encodedDataLength?: number;
    redirectedFrom?: string;
    redirectedTo?: string;
    errorText?: string;
}
export interface NetworkRequestDetails extends NetworkRequestSummary {
    timestamp: number;
    requestHeaders: Record<string, string>;
    responseHeaders?: Record<string, string>;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    canceled?: boolean;
    blockedReason?: Protocol.Network.BlockedReason;
    corsErrorStatus?: Protocol.Network.CorsErrorStatus;
    /** Locations use CDP's zero-based lineNumber/columnNumber. */
    initiator: {
        type: Protocol.Network.Initiator['type'];
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
        callFrames: Protocol.Runtime.CallFrame[];
        stackTruncated: boolean;
    };
}
export type NetworkResponseBody = {
    requestId: string;
    available: true;
    body: string;
    base64Encoded: boolean;
    /** Offsets and lengths count characters in the returned encoding, not decoded bytes. */
    offset: number;
    totalLength: number;
    truncated: boolean;
    nextOffset?: number;
} | {
    requestId: string;
    available: false;
    reason: string;
};
type NetworkEvent = {
    method: 'Network.requestWillBeSent';
    params: Protocol.Network.RequestWillBeSentEvent;
} | {
    method: 'Network.responseReceived';
    params: Protocol.Network.ResponseReceivedEvent;
} | {
    method: 'Network.loadingFinished';
    params: Protocol.Network.LoadingFinishedEvent;
} | {
    method: 'Network.loadingFailed';
    params: Protocol.Network.LoadingFailedEvent;
};
export type NetworkCaptureState = {
    entries: NetworkRequestDetails[];
    nextId: number;
};
/** Deterministic event reduction keeps redirect IDs and bounded capture independently testable. */
export declare function reduceNetworkEvent({ state, event, maxEntries, }: {
    state: NetworkCaptureState;
    event: NetworkEvent;
    maxEntries: number;
}): NetworkCaptureState;
/** Body slices preserve CDP encoding; a base64 slice is not independently decodable. */
export declare function sliceNetworkBody({ requestId, body, base64Encoded, offset, limit, }: {
    requestId: string;
    body: string;
    base64Encoded: boolean;
    offset?: number;
    limit?: number;
}): NetworkResponseBody;
/**
 * Opt-in, memory-bounded request metadata for one CDP target. No request/response bodies
 * are retained. Headers are a redacted, bounded CDP view, not a complete wire capture.
 * Enable before reproducing the request; existing traffic is not replayed.
 */
export declare class NetworkInspector {
    private cdp;
    private maxEntries;
    private capture;
    private enabling;
    private disposed;
    private onRequest;
    private onResponse;
    private onFinished;
    private onFailed;
    constructor({ cdp, maxEntries }: {
        cdp: ICDPSession;
        maxEntries?: number;
    });
    private record;
    enable(): Promise<void>;
    list({ search, method, status, limit, }?: {
        search?: string;
        method?: string;
        status?: number | 'failed';
        limit?: number;
    }): NetworkRequestSummary[];
    inspect({ requestId }: {
        requestId: string;
    }): NetworkRequestDetails | null;
    responseBody({ requestId, offset, limit, }: {
        requestId: string;
        offset?: number;
        limit?: number;
    }): Promise<NetworkResponseBody>;
    clear(): void;
    private removeListeners;
    /** Remove only this inspector's listeners; other consumers own the shared CDP domains. */
    dispose(): void;
}
export {};
```