/** A socket driven by the test, while the real socket provider handles every frame. */
export class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances: MockWebSocket[] = [];

    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    sent: string[] = [];

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    send(data: string) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
    emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
