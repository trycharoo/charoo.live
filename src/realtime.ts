// The interface keeps UI events stable while each authority owns its socket.
export class Realtime {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  private sockets = new Map<string, WebSocket>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private attempts = new Map<string, number>();
  private desired = new Map<string, string>();
  private stopped = false;
  private ping: ReturnType<typeof setInterval>;
  constructor() {
    this.desired.set("user", "/api/events/socket");
    this.connect("user");
    this.ping = setInterval(() => {
      for (const socket of this.sockets.values())
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: "ping" }));
    }, 25000);
  }
  private emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  private connect(key: string) {
    const path = this.desired.get(key);
    if (this.stopped || !path) return;
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`,
    );
    this.sockets.set(key, socket);
    socket.onopen = () => {
      if (this.stopped || !this.desired.has(key)) return socket.close();
      const recovered = (this.attempts.get(key) || 0) > 0;
      this.attempts.set(key, 0);
      if (key === "user") {
        this.readyState = WebSocket.OPEN;
        this.onopen?.();
      }
      if (recovered && key.startsWith("room:"))
        this.emit({ type: "room.changed", roomId: key.slice(5) });
      if (recovered && key === "discovery")
        this.emit({ type: "discovery.changed" });
    };
    socket.onmessage = (event) =>
      this.onmessage?.({ data: String(event.data) });
    socket.onerror = () => socket.close();
    socket.onclose = (event) => {
      if (
        this.sockets.get(key) !== socket ||
        this.stopped ||
        !this.desired.has(key)
      )
        return;
      if (event.code === 1008 || event.code === 4001) {
        this.desired.delete(key);
        if (key === "user") this.emit({ type: "session.revoked" });
        else if (key.startsWith("room:"))
          this.emit({ type: "room.changed", roomId: key.slice(5) });
        return;
      }
      const attempt = (this.attempts.get(key) || 0) + 1;
      this.attempts.set(key, attempt);
      if (key === "user") {
        this.readyState = WebSocket.CONNECTING;
        this.onclose?.();
      }
      this.timers.set(
        key,
        setTimeout(
          () => this.connect(key),
          Math.min(30000, 500 * 2 ** Math.min(attempt, 6)) +
            Math.random() * 500,
        ),
      );
    };
  }
  private remove(key: string) {
    this.desired.delete(key);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.sockets.get(key)?.close();
    this.sockets.delete(key);
  }
  send(data: string) {
    const event = JSON.parse(data);
    if (event.type === "subscribe") {
      for (const old of [...this.desired.keys()])
        if (old.startsWith("room:") && old !== `room:${event.roomId}`)
          this.remove(old);
      const key = `room:${event.roomId}`;
      if (!this.desired.has(key)) {
        this.desired.set(key, `/api/rooms/${event.roomId}/socket`);
        this.connect(key);
      }
    } else if (event.type === "unsubscribe")
      this.remove(`room:${event.roomId}`);
    else if (event.type === "discovery") {
      if (!event.payload) this.remove("discovery");
      else if (!this.desired.has("discovery")) {
        this.desired.set("discovery", "/api/discovery/socket");
        this.connect("discovery");
      }
    } else if (event.type === "typing") {
      const socket = this.sockets.get(`room:${event.roomId}`);
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "typing" }));
    }
  }
  close() {
    this.stopped = true;
    this.readyState = WebSocket.CLOSED;
    clearInterval(this.ping);
    for (const key of [...this.desired.keys()]) this.remove(key);
  }
}
