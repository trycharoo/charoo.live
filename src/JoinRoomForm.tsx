import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Link, Shield } from "lucide-react";
import { roomTokenFromUrl } from "./room-invite";

export function JoinRoomForm({ onJoin }: { onJoin: (token: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onJoin(roomTokenFromUrl(url));
    } catch (reason) {
      setError((reason as Error).message);
      input.current?.focus();
    }
  }
  return (
    <form className="join-room-form" onSubmit={submit} noValidate>
      <div className="join-room-intro">
        <span className="join-room-icon" aria-hidden="true">
          <Link size={22} />
        </span>
        <p>
          Have an invite? Paste the link from your host, then choose the
          nickname you’ll use in the room.
        </p>
      </div>
      <label>
        Room invitation URL
        <input
          ref={input}
          type="url"
          name="roomUrl"
          required
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={2048}
          placeholder="https://charoo.live/#room=…"
          value={url}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "join-room-error" : "join-room-hint"}
          onChange={(event) => {
            setUrl(event.target.value);
            setError("");
          }}
        />
      </label>
      {error ? (
        <p className="join-room-error" id="join-room-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="form-note" id="join-room-hint">
          Use the full invitation URL shared by the host.
        </p>
      )}
      <div className="join-room-note">
        <Shield size={15} aria-hidden="true" />
        <span>
          If the room requires approval, the host will review your request.
        </span>
      </div>
      <button className="button" type="submit">
        Continue <ArrowRight size={17} />
      </button>
    </form>
  );
}
