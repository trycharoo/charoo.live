import { useEffect, useRef, useState } from "react";
import { api, getCsrf } from "./api";

type PictureStatus = {
  picture: { id: string; url: string } | null;
  uploadAvailable: boolean;
};

export function ProfilePicture() {
  const [status, setStatus] = useState<PictureStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  async function load() {
    const next = await api<PictureStatus>("/profile/picture");
    if (mounted.current) setStatus(next);
  }
  useEffect(() => {
    mounted.current = true;
    load()
      .catch((e: Error) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("Choose a JPEG, PNG or WebP picture.");
      if (!file.size || file.size > 5 * 1048576)
        throw new Error("Choose a picture up to 5 MB.");
      const initial = await api<{ id: string; url: string }>(
        "/profile/picture/init",
        "POST",
        { mime: file.type, size: file.size },
      );
      const response = await fetch(initial.url, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": file.type,
          "X-CSRF-Token": getCsrf(),
        },
        body: file,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error || "Picture upload failed. Please try again.",
        );
      }
      await api(`/profile/picture/${initial.id}/complete`, "POST", {});
      await load();
      if (mounted.current)
        setNotice(
          "Profile picture saved. You choose whether to share it in each quick chat.",
        );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section
      className="profile-picture-settings"
      aria-label="Your profile picture"
    >
      <h2>Profile picture</h2>
      <p>
        Your picture is private. After ten qualifying messages each in a quick
        chat, you can choose to show it to that person.
      </p>
      {loading ? (
        <p role="status">Loading your picture…</p>
      ) : status?.picture ? (
        <img
          className="profile-picture-preview"
          src={`${status.picture.url}?v=${encodeURIComponent(status.picture.id)}`}
          alt="Your private profile picture"
        />
      ) : (
        <p className="muted">No profile picture saved.</p>
      )}
      {status?.uploadAvailable && (
        <label className="profile-picture-upload">
          {status.picture ? "Replace profile picture" : "Add profile picture"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void upload(file);
            }}
          />
          <small>
            JPEG, PNG or WebP, up to 5 MB. Your picture is checked before it is
            saved.
          </small>
        </label>
      )}
      {status && !status.uploadAvailable && (
        <p className="muted">Picture uploads are currently unavailable.</p>
      )}
      {busy && <p role="status">Uploading and checking your picture…</p>}
      {error && <p role="alert">{error}</p>}
      {error && !status && (
        <button
          type="button"
          className="button secondary small"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError("");
            try {
              await load();
            } catch (e) {
              if (mounted.current) setError((e as Error).message);
            } finally {
              if (mounted.current) setLoading(false);
            }
          }}
        >
          Retry loading picture
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
