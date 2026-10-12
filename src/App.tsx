import { Realtime } from "./realtime";
import { RoomSidebar } from "./RoomSidebar";
import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Sparkles,
  Compass,
  Shuffle,
  Users,
  Link,
  Copy,
  MessageCircle,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  Shield,
  Settings,
  LogOut,
  Menu,
  X,
  Send,
  Paperclip,
  Video,
  Flag,
  Clock,
  ChevronLeft,
  Check,
  Download,
  Globe,
  Radio,
} from "lucide-react";
import {
  categories,
  type User,
  type Room,
  type Message,
  type Settings as AppSettings,
  type Profile,
} from "@charoo/contracts";
import { api, setCsrf, getCsrf } from "./api";
const VideoCall = lazy(() =>
  import("./Call").then((m) => ({ default: m.VideoCall })),
);
type Page =
  | "tonight"
  | "strangers"
  | "groups"
  | "contacts"
  | "profile"
  | "admin";
const mobileNavLabels: Record<Page, string> = {
  groups: "Rooms",
  tonight: "Discover",
  strangers: "Chat",
  contacts: "Contacts",
  profile: "Profile",
  admin: "Admin",
};
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const field = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) || "");
const profileFromForm = (
  form: HTMLFormElement,
  previous?: Profile,
): Profile => ({
  region: "",
  bio: "",
  interests: [],
  aslVisibility: "private",
  ...previous,
  displayName: field(form, "displayName").trim(),
  age: field(form, "age") ? Number(field(form, "age")) : null,
  gender: field(form, "gender"),
});
function JoinProfileFields({ profile }: { profile?: Profile }) {
  const sexes = ["Male", "Female", "Other"];
  return (
    <>
      <label>
        Nickname
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={40}
          autoComplete="nickname"
          placeholder="What should we call you?"
          defaultValue={profile?.displayName || ""}
        />
      </label>
      <div className="form-grid">
        <label>
          Age (optional)
          <input
            type="number"
            name="age"
            min={18}
            max={120}
            step={1}
            placeholder="Optional"
            defaultValue={profile?.age ?? ""}
          />
        </label>
        <label>
          Sex (optional)
          <select
            name="gender"
            aria-label="Sex (optional)"
            defaultValue={profile?.gender || ""}
          >
            <option value="">Prefer not to say</option>
            {profile?.gender && !sexes.includes(profile.gender) && (
              <option value={profile.gender}>{profile.gender}</option>
            )}
            {sexes.map((sex) => (
              <option key={sex}>{sex}</option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
export function App() {
  const bootstrapped = useRef(false);
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState<Page>(
      location.pathname.startsWith("/admin") ? "admin" : "groups",
    ),
    [settings, setSettings] = useState<AppSettings | null>(null),
    [rooms, setRooms] = useState<Room[]>([]),
    [conversations, setConversations] = useState<Room[]>([]),
    [active, setActive] = useState<any>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState(""),
    [status, setStatus] = useState("Online"),
    [queue, setQueue] = useState(false),
    [modal, setModal] = useState<string | null>(null),
    [joinProfilePending, setJoinProfilePending] = useState(() =>
      Boolean(new URLSearchParams(location.hash.slice(1)).get("room")),
    ),
    [toast, setToast] = useState(""),
    [error, setError] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [requests, setRequests] = useState<any[]>([]),
    [contacts, setContacts] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [blocks, setBlocks] = useState<any[]>([]),
    [shareUrl, setShareUrl] = useState(""),
    [inviteCopyMessage, setInviteCopyMessage] = useState(""),
    [connected, setConnected] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [createAfterGuest, setCreateAfterGuest] = useState(false),
    [pending, setPending] = useState<any[]>([]),
    [reply, setReply] = useState<Message | null>(null),
    [typing, setTyping] = useState(false),
    [admin, setAdmin] = useState<any>(null),
    [adminReports, setAdminReports] = useState<any[]>([]),
    [adminRooms, setAdminRooms] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [calls, setCalls] = useState<any[]>([]),
    [callId, setCallId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [googleEnabled, setGoogleEnabled] = useState(false),
    [feedNext, setFeedNext] = useState<string | null>(null),
    [messageNext, setMessageNext] = useState<string | null>(null),
    [install, setInstall] = useState<any>(null);
  const ws = useRef<Realtime | null>(null),
    activeRef = useRef<any>(null),
    userRef = useRef<User | null>(null),
    statusRef = useRef(status),
    actionRef = useRef<(e: any) => void>(() => {}),
    acks = useRef(
      new Map<string, { resolve: () => void; reject: () => void }>(),
    ),
    chatEnd = useRef<HTMLDivElement>(null),
    shareLinkInput = useRef<HTMLInputElement>(null),
    typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    explicitAvailable = useRef(false);
  activeRef.current = active;
  userRef.current = user;
  statusRef.current = status;
  const notify = (text: string, isError = false) => {
    setToast(text);
    setError(isError);
  };
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      notify((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const background = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  async function me() {
    const result = await api("/me");
    setUser(result.user);
    userRef.current = result.user;
    setCsrf(result.csrf);
    setSettings(result.settings);
    return result;
  }
  async function loadRooms(more = false) {
    if (!userRef.current?.verified) return;
    const result = await api(
      `/rooms?q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}${more && feedNext ? `&before=${encodeURIComponent(feedNext)}` : ""}`,
    );
    setRooms((prev) =>
      more
        ? [
            ...prev,
            ...result.rooms.filter(
              (r: Room) => !prev.some((p) => p.id === r.id),
            ),
          ]
        : result.rooms,
    );
    setFeedNext(result.next);
  }
  async function loadSocial() {
    const [cs, rs, cts, hs, bs, vs] = await Promise.all([
      api("/conversations"),
      api("/requests"),
      api("/contacts"),
      userRef.current?.verified ? api("/reconnect") : Promise.resolve([]),
      api("/blocks"),
      api("/calls"),
    ]);
    setConversations(cs);
    setRequests(rs);
    setContacts(cts);
    setHistory(hs);
    setBlocks(bs);
    setCalls(vs);
  }
  async function openRoom(id: string) {
    setMobileNav(false);
    const room = await api(`/rooms/${id}`),
      result = await api(`/rooms/${id}/messages`);
    setActive(room);
    activeRef.current = room;
    setMessages(result.messages);
    setMessageNext(result.next);
    setQueue(false);
    setDraft("");
    setReply(null);
    setTyping(false);
    if (ws.current?.readyState === 1)
      ws.current.send(JSON.stringify({ type: "subscribe", roomId: id }));
    await api(`/rooms/${id}/read`, "POST", {});
  }
  async function refreshChat() {
    const room = activeRef.current;
    if (!room) return;
    try {
      const [data, meta] = await Promise.all([
        api(`/rooms/${room.id}/messages`),
        api(`/rooms/${room.id}`),
      ]);
      setMessages(data.messages);
      setMessageNext(data.next);
      setActive(meta);
      await api(`/rooms/${room.id}/read`, "POST", {});
    } catch (e) {
      setActive(null);
      activeRef.current = null;
      notify((e as Error).message, true);
    }
  }
  async function heartbeat() {
    if (!userRef.current) return;
    const value = await api("/presence", "POST", {
      status: statusRef.current,
      roomId: activeRef.current?.id,
      heartbeat: !explicitAvailable.current,
    });
    explicitAvailable.current = false;
    setStatus(value.status);
  }
  async function loadAdmin() {
    const [d, r, rs] = await Promise.all([
      api("/admin/dashboard"),
      api("/admin/reports"),
      api("/admin/rooms"),
    ]);
    setAdmin(d);
    setAdminReports(r);
    setAdminRooms(rs);
    if (userRef.current?.role === "ADMIN") setAudit(await api("/admin/audit"));
  }
  async function joinShared() {
    if (joinProfilePending) return;
    const t = new URLSearchParams(location.hash.slice(1)).get("room");
    if (t) {
      try {
        const room = await api("/shared/join", "POST", { token: t });
        await openRoom(room.id);
        await loadSocial();
        const params = new URLSearchParams(location.hash.slice(1));
        if (params.get("room") === t) {
          params.delete("room");
          window.history.replaceState(
            null,
            "",
            `${location.pathname}${location.search}${params.size ? `#${params}` : ""}`,
          );
        }
      } catch (e) {
        setJoinProfilePending(true);
        throw e;
      }
    }
  }
  useEffect(() => {
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      api("/auth/providers")
        .then((providers) => setGoogleEnabled(providers.google))
        .catch(() => {});
      (async () => {
        try {
          const params = new URLSearchParams(location.hash.slice(1));
          const googleResult = params.get("auth");
          const authError = params.get("authError");
          const createAfterSignIn = params.get("create") === "1";
          if (googleResult || authError) {
            params.delete("auth");
            params.delete("authError");
            params.delete("create");
            window.history.replaceState(
              null,
              "",
              `${location.pathname}${location.search}${params.size ? `#${params}` : ""}`,
            );
            if (authError) {
              const messages: Record<string, string> = {
                cancelled:
                  "Google sign-in was cancelled. You can try again or continue as a guest.",
                expired: "Google sign-in expired. Please try again.",
                session_changed:
                  "Your sign-in changed in another tab. Please try again.",
                account_conflict:
                  "That Google account belongs to a different identity. Sign out before switching accounts.",
                email_required:
                  "Sign in using an email link first, then connect Google from your profile.",
              };
              notify(
                messages[authError] ||
                  "Google sign-in didn’t complete. Please try again.",
                true,
              );
            } else if (googleResult === "google") {
              notify("Signed in with Google. Welcome to Charoo.");
            }
          }
          const verification = new URLSearchParams(location.hash.slice(1)).get(
            "verify",
          );
          if (verification) {
            params.delete("verify");
            window.history.replaceState(
              null,
              "",
              `${location.pathname}${location.search}${params.size ? `#${params}` : ""}`,
            );
            const result = await api("/auth/verify", "POST", {
              token: verification,
            });
            setCsrf(result.csrf);
            notify("Email verified. Welcome to Charoo.");
          }
          await me();
          if (params.has("room")) setModal("joinProfile");
          if (
            googleResult === "google" &&
            createAfterSignIn &&
            !params.has("room")
          )
            setModal("shared");
        } catch (e) {
          if (!String((e as Error).message).includes("Sign in"))
            notify((e as Error).message, true);
          if (new URLSearchParams(location.hash.slice(1)).has("room"))
            setModal("guest");
        } finally {
          setLoading(false);
        }
      })();
    }
    const listener = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", listener);
    return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  useEffect(() => {
    const invitationChanged = () => {
      if (!new URLSearchParams(location.hash.slice(1)).get("room")) return;
      setJoinProfilePending(true);
      setCreateAfterGuest(false);
      setModal(userRef.current ? "joinProfile" : "guest");
    };
    window.addEventListener("hashchange", invitationChanged);
    return () => window.removeEventListener("hashchange", invitationChanged);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (!mobileNav) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, [mobileNav]);
  useEffect(() => {
    if (!user || loading) return;
    background(async () => {
      await heartbeat();
      await loadSocial();
      await joinShared();
    });
    const t = setInterval(
      () => heartbeat().catch(() => setConnected(false)),
      25000,
    );
    return () => clearInterval(t);
  }, [user?.id, loading, joinProfilePending]);
  useEffect(() => {
    if (!user?.verified || page !== "tonight") return;
    const t = setTimeout(() => background(() => loadRooms()), 250);
    return () => clearTimeout(t);
  }, [search, category, page, user?.verified]);
  useEffect(() => {
    if (page === "admin" && user && user.role !== "USER") background(loadAdmin);
  }, [page, user?.id]);
  useEffect(() => {
    if (ws.current?.readyState === 1 && user?.verified)
      ws.current.send(
        JSON.stringify({
          type: "discovery",
          payload: page === "tonight" && !active,
        }),
      );
  }, [page, active?.id, connected, user?.verified]);
  useEffect(() => {
    if (!active || connected) return;
    const t = setInterval(() => refreshChat().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [active?.id, connected]);
  useEffect(() => {
    if (!queue) return;
    const t = setInterval(
      () =>
        background(async () => {
          const result = await api("/match", "POST", {});
          if (result.roomId) await openRoom(result.roomId);
        }),
      5000,
    );
    return () => clearInterval(t);
  }, [queue]);
  actionRef.current = (event: any) => {
    if (event.type === "ack") {
      const ack = acks.current.get(event.payload.clientMessageId);
      if (ack) ack.resolve();
    }
    if (event.type === "read" && event.roomId === activeRef.current?.id)
      api(`/rooms/${event.roomId}/messages`)
        .then((r) => setMessages(r.messages))
        .catch(() => {});
    if (event.type === "matched")
      background(async () => {
        await openRoom(event.payload.roomId);
        await loadSocial();
      });
    if (
      ["message", "room.changed"].includes(event.type) &&
      event.roomId === activeRef.current?.id
    )
      background(refreshChat);
    if (
      event.type === "room.closed" &&
      event.roomId === activeRef.current?.id
    ) {
      setActive(null);
      activeRef.current = null;
      notify("This room has closed.");
      background(loadSocial);
    }
    if (
      event.type === "discovery.changed" &&
      userRef.current?.verified &&
      page === "tonight" &&
      !activeRef.current
    ) {
      background(() => loadRooms());
    }
    if (
      ["request", "call.request"].includes(event.type) &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      document.hidden
    )
      new Notification("A new hello on Charoo", {
        body:
          event.type === "request"
            ? "You have a new connection request."
            : "You have a video invitation.",
        icon: "/icon-192.png",
      });
    if (
      [
        "request",
        "request.responded",
        "call.request",
        "call.changed",
        "blocked",
        "unblocked",
      ].includes(event.type)
    ) {
      background(async () => {
        await loadSocial();
        if (activeRef.current) await refreshChat();
      });
    }
    if (
      event.type === "typing" &&
      event.payload.userId !== userRef.current?.id
    ) {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 2500);
    }
    if (event.type === "session.revoked") {
      setUser(null);
      setActive(null);
      notify("Your session is no longer available.", true);
    }
  };
  useEffect(() => {
    if (!user) return;

    function connect() {
      const socket = new Realtime();
      ws.current = socket;
      socket.onopen = () => {
        setConnected(true);
        if (userRef.current?.verified)
          socket.send(
            JSON.stringify({ type: "discovery", payload: page === "tonight" }),
          );
        if (activeRef.current)
          socket.send(
            JSON.stringify({ type: "subscribe", roomId: activeRef.current.id }),
          );
        background(async () => {
          await loadSocial();
          if (activeRef.current) await refreshChat();
        });
      };
      socket.onmessage = (e) => {
        try {
          actionRef.current(JSON.parse(e.data));
        } catch {}
      };
      socket.onclose = () => {
        setConnected(false);
      };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => {
      ws.current?.close();
    };
  }, [user?.id, getCsrf()]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages.length]);
  async function startGuest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await act(async () => {
      const value = await api("/auth/guest", "POST", {
        communityConsent: true,
        profile: profileFromForm(form),
      });
      setCsrf(value.csrf);
      setUser(value.user);
      userRef.current = value.user;
      setJoinProfilePending(false);
      setModal(createAfterGuest && !hasRoomInvite ? "shared" : null);
      setCreateAfterGuest(false);
    });
  }
  async function completeJoinProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await act(async () => {
      const value = await api(
        "/me/profile",
        "PATCH",
        profileFromForm(form, userRef.current?.profile),
      );
      setUser(value);
      userRef.current = value;
      setModal(null);
      setJoinProfilePending(false);
    });
  }
  async function email(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await act(async () => {
      const r = await api("/auth/email", "POST", {
        email: field(form, "email"),
        communityConsent: true,
        roomToken:
          new URLSearchParams(location.hash.slice(1)).get("room") || undefined,
      });
      notify(r.message);
      setModal(null);
    });
  }
  async function signInWithGoogle() {
    await act(async () => {
      const roomToken =
        new URLSearchParams(location.hash.slice(1)).get("room") || undefined;
      const result = await api("/auth/google", "POST", {
        communityConsent: true,
        roomToken,
        createRoom: createAfterGuest,
      });
      location.assign(result.url);
    });
  }
  async function createRoom(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await act(async () => {
      const r = await api("/rooms", "POST", {
        clientOperationId: (form.dataset.operationId ||= crypto.randomUUID()),
        type: modal === "public" ? "AVAILABLE_TONIGHT" : "SHARED_GROUP",
        title: field(form, "title"),
        description: field(form, "description"),
        category: field(form, "category") || "Conversation",
        region: field(form, "region"),
        tags: field(form, "tags")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        verifiedOnly: new FormData(form).has("verified"),
        durationHours: Number(field(form, "duration") || 12),
      });
      setShareUrl(r.shareUrl || "");
      setInviteCopyMessage("");
      setModal(r.shareUrl ? "share" : null);
      await openRoom(r.id);
      await loadSocial();
    });
  }
  async function openInvite() {
    const room = activeRef.current;
    if (!room) return;
    await act(async () => {
      const url =
        room.shareUrl ||
        (await api(`/rooms/${room.id}/invite`, "POST", {})).shareUrl;
      if (activeRef.current?.id !== room.id) return;
      setActive((current: any) => ({ ...current, shareUrl: url }));
      setShareUrl(url);
      setInviteCopyMessage("");
      setModal("invite");
    });
  }
  async function copyInvite(url: string, input: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopyMessage("Invite link copied.");
      notify("Invite link copied.");
    } catch {
      input?.focus();
      input?.select();
      setInviteCopyMessage("Link selected. Copy it manually.");
      notify("Link selected. Copy it manually.");
    }
  }
  async function submitMessage(payload: any) {
    const roomId = activeRef.current?.id;
    if (!roomId) return;
    if (
      activeRef.current?.mutedUntil &&
      Date.parse(activeRef.current.mutedUntil) > Date.now()
    )
      throw new Error(
        "The host muted you. You can send messages after you are unmuted.",
      );
    await api(`/rooms/${roomId}/messages`, "POST", payload);
    setPending((prev) =>
      prev.filter((p) => p.clientMessageId !== payload.clientMessageId),
    );
    await refreshChat();
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !active || isMuted) return;
    const payload = {
      clientMessageId: crypto.randomUUID(),
      text: draft.trim(),
      replyTo: reply?.id,
    };
    setDraft("");
    setReply(null);
    setPending((p) => [...p, { ...payload, roomId: active.id }]);
    try {
      await submitMessage(payload);
    } catch (e) {
      notify(`${(e as Error).message} — your message is ready to retry.`, true);
    }
  }
  async function attach(file: File) {
    await act(async () => {
      const room = activeRef.current;
      if (!room) return;
      if (room.mutedUntil && Date.parse(room.mutedUntil) > Date.now())
        throw new Error("You cannot send attachments while muted.");
      const init = await api("/media/init", "POST", {
        roomId: room.id,
        name: file.name,
        mime: file.type,
        size: file.size,
      });
      const response = await fetch(init.url, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": file.type, "X-CSRF-Token": getCsrf() },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      await api(`/media/${init.id}/complete`, "POST", {});
      await submitMessage({
        clientMessageId: crypto.randomUUID(),
        text: `Attachment: ${file.name}`,
        attachmentId: init.id,
      });
    });
  }
  const nav: [Page, string, ReactNode][] = [
    ["groups", "Your rooms", <Link size={20} />],
    ["tonight", "Discover rooms", <Compass size={20} />],
    ["strangers", "Quick chat", <Shuffle size={20} />],
    ["contacts", "Your connections", <Users size={20} />],
    ["profile", "Your profile", <Settings size={20} />],
  ];
  if (user && user.role !== "USER")
    nav.push(["admin", "Moderation", <Shield size={20} />]);
  const choosePage = (p: Page) => {
    setPage(p);
    if (activeRef.current && ws.current?.readyState === 1)
      ws.current.send(
        JSON.stringify({ type: "unsubscribe", roomId: activeRef.current.id }),
      );
    setActive(null);
    activeRef.current = null;
    setMobileNav(false);
  };
  const startSharedRoom = () => {
    if (user) setModal("shared");
    else {
      setCreateAfterGuest(true);
      setModal("guest");
    }
  };
  const hasRoomInvite = new URLSearchParams(location.hash.slice(1)).has("room");
  const request = (targetId: string, kind: string) =>
    act(async () => {
      await api("/requests", "POST", {
        targetId,
        kind,
        roomId: activeRef.current?.id,
      });
      notify("Request sent. They decide whether to accept.");
    });
  const moderation = (action: string, targetId?: string) =>
    act(async () => {
      await api(`/rooms/${active.id}/moderate`, "POST", { action, targetId });
      if (action === "CLOSE") {
        choosePage(page);
      } else {
        await refreshChat();
        if (action === "MUTE")
          notify(
            "Member muted for 30 minutes. Click Unmute to let them chat again.",
          );
        if (action === "UNMUTE")
          notify("Member unmuted. They can send messages again.");
        if (action === "REMOVE") notify("Member removed from this room.");
      }
    });
  const toggleBlock = (targetId: string) =>
    act(async () => {
      const blocked = blocks.some((b) => b.id === targetId);
      if (blocked) await api(`/blocks/${targetId}`, "DELETE");
      else await api("/blocks", "POST", { targetId });
      await loadSocial();
      notify(
        blocked
          ? "Member unblocked. Their messages are visible again."
          : "Member blocked. Their messages are hidden from you.",
      );
      await refreshChat();
    });
  const isOwner =
    active?.creator_id === user?.id &&
    ["AVAILABLE_TONIGHT", "SHARED_GROUP"].includes(active?.type);
  const peers =
    active?.participants?.filter((p: any) => p.id !== user?.id) || [];
  const isMuted = Boolean(
    active?.mutedUntil && Date.parse(active.mutedUntil) > Date.now(),
  );
  useEffect(() => {
    if (!active) return;
    const deadlines = [
      active.mutedUntil,
      ...active.participants.map((p: any) => p.mutedUntil),
    ]
      .filter(Boolean)
      .map((until: string) => Date.parse(until) - Date.now())
      .filter((delay: number) => delay > 0);
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => background(refreshChat),
      Math.min(...deadlines) + 50,
    );
    return () => clearTimeout(timer);
  }, [active?.id, active?.mutedUntil, active?.participants]);
  if (loading)
    return (
      <div className="loading">
        <Sparkles />
        <p>Getting your room ready…</p>
      </div>
    );
  return (
    <div className={`app ${active ? "in-chat" : ""}`}>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        id="primary-sidebar"
        className={`sidebar ${active ? "room-sidebar" : ""} ${mobileNav ? "visible" : ""}`}
        aria-label={active ? "Room sidebar" : "Main sidebar"}
      >
        {active ? (
          <RoomSidebar
            room={active}
            user={user}
            isOwner={isOwner}
            busy={busy}
            blocks={blocks}
            onBack={() => choosePage(page)}
            onClose={() => setMobileNav(false)}
            onInvite={openInvite}
            onCopyInvite={copyInvite}
            onRequest={request}
            onModerate={moderation}
            onToggleBlock={toggleBlock}
            onVideoInvite={(targetId) =>
              act(async () => {
                await api("/calls", "POST", { roomId: active.id, targetId });
                notify("Video call invitation sent.");
                await loadSocial();
              })
            }
            onEditRoom={() => setModal("editRoom")}
            onReportRoom={() => setModal("report")}
          />
        ) : (
          <>
            <a className="brand" href="/" aria-label="Charoo home">
              <span>
                <Sparkles size={23} />
              </span>
              charoo<span className="brand-dot">.</span>
            </a>
            <div className="sidebar-caption">A LINK. A ROOM. YOUR PEOPLE.</div>
            <nav aria-label="Main navigation">
              {nav.map(([p, label, icon]) => (
                <button
                  key={p}
                  className={page === p && !active ? "selected" : ""}
                  aria-current={page === p && !active ? "page" : undefined}
                  onClick={() => choosePage(p)}
                >
                  {icon}
                  <span>{label}</span>
                  {p === "contacts" && requests.length > 0 && (
                    <b className="count">{requests.length}</b>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-rooms">
              <div className="eyebrow">ACTIVE CONVERSATIONS</div>
              {conversations.slice(0, 7).map((r) => (
                <button
                  key={r.id}
                  className={active?.id === r.id ? "selected" : ""}
                  onClick={() => act(() => openRoom(r.id))}
                >
                  <MessageCircle size={16} />
                  <span>{r.title}</span>
                </button>
              ))}
              {!conversations.length && (
                <p>Your next group chat is just a link away.</p>
              )}
            </div>
            <div className="sidebar-bottom">
              <div className="safety">
                <Shield size={17} />
                <span>
                  Here for the moment
                  <br />
                  <small>Temporary rooms. Real conversations.</small>
                </span>
              </div>
              {install && (
                <button onClick={() => install.prompt()}>
                  <Download size={16} />
                  Install Charoo
                </button>
              )}
              {user ? (
                <>
                  <button
                    className="user-mini"
                    onClick={() => choosePage("profile")}
                  >
                    <span className="avatar">{user.displayName[0]}</span>
                    <span>
                      {user.displayName}
                      <small>
                        {user.verified
                          ? "Verified member"
                          : "Guest · temporary identity"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="quiet"
                    onClick={() =>
                      act(async () => {
                        await api("/auth/logout", "POST", {});
                        setUser(null);
                        setCsrf("");
                        setActive(null);
                        setConversations([]);
                        setPending([]);
                      })
                    }
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </>
              ) : (
                <button onClick={() => setModal("guest")}>
                  Join the conversation <ArrowRight size={16} />
                </button>
              )}
            </div>
          </>
        )}
      </aside>
      <main>
        <header className="topbar">
          <div className="mobile-header">
            <button
              className="icon-button"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label={active ? "Show room members" : "Toggle menu"}
              aria-expanded={mobileNav}
              aria-controls="primary-sidebar"
            >
              <Menu size={21} />
              <span>{active ? "Members" : "Menu"}</span>
            </button>
            <a className="mobile-brand" href="/" aria-label="Charoo home">
              charoo<span>.</span>
            </a>
          </div>
          <div className="breadcrumb">
            LESS SETUP, MORE CONVERSATION <span>✦</span>
          </div>
          <div className="header-actions">
            {user && (
              <>
                <span className={`connection ${connected ? "on" : ""}`}>
                  {connected ? "Live" : "Reconnecting"}
                </span>
                <select
                  aria-label="Availability status"
                  value={status}
                  onChange={(e) => {
                    const next = e.target.value;
                    statusRef.current = next;
                    setStatus(next);
                    explicitAvailable.current = next === "Available Tonight";
                    act(heartbeat);
                  }}
                >
                  <option>Online</option>
                  <option>Offline</option>
                  {user.verified && (
                    <option value="Available Tonight">Open to chat</option>
                  )}
                </select>
              </>
            )}
            {!user && (
              <button
                className="button small"
                onClick={() => setModal("email")}
              >
                Sign in <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </header>
        {!active && ["groups", "tonight"].includes(page) && (
          <section className="hero">
            <div className="hero-copy">
              <span className="pill">
                <span className="live-dot" /> GROUP CHAT, WITHOUT THE SETUP
              </span>
              <h1>
                One link.
                <br />
                <em>Everyone’s in.</em>
              </h1>
              <p>
                Skip picking participants. Just share a URL.
                <br />
                Anyone with the link can join your temporary room.
              </p>
              <div className="hero-actions">
                <button
                  className="button"
                  onClick={
                    hasRoomInvite
                      ? () => setModal(user ? "joinProfile" : "guest")
                      : startSharedRoom
                  }
                >
                  <Plus size={18} />
                  {hasRoomInvite ? "Join this room" : "Start a room"}
                </button>
                <span>You host. You moderate. The room expires.</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="bubble bubble-one">
                made a room. here’s the link ✦
              </div>
              <div className="bubble bubble-two">
                I’m in! sending it to the others ☕
              </div>
              <div className="bubble bubble-three">
                <Users size={20} /> everyone’s here. let’s chat.
              </div>
              <div className="art-star">✳</div>
            </div>
          </section>
        )}
        {!active && page === "tonight" && (
          <>
            <section className="discovery">
              <div className="section-title">
                <div>
                  <span className="eyebrow">FIND A CONVERSATION</span>
                  <h2>
                    Open rooms <span className="live-dot" />
                  </h2>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    user?.verified ? setModal("public") : setModal("email")
                  }
                >
                  Create a room <Plus size={16} />
                </button>
              </div>
              {!user?.verified ? (
                <div className="gate">
                  <span className="gate-icon">
                    <Globe size={28} />
                  </span>
                  <h3>A room for every conversation.</h3>
                  <p>
                    Verify your email to discover public topic rooms and meet
                    other verified members. You can create or join a room by
                    link as a guest.
                  </p>
                  <button className="button" onClick={() => setModal("email")}>
                    Explore with a verified account <ArrowRight size={16} />
                  </button>
                  <button className="text-button" onClick={startSharedRoom}>
                    Or start a room with a link
                  </button>
                </div>
              ) : (
                <>
                  <div className="filters">
                    <label className="search">
                      <Search size={18} />
                      <input
                        placeholder="Find a topic, tag or conversation…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="chips">
                    {[
                      "",
                      "Conversation",
                      "Hangout",
                      "Gaming",
                      "Food & Drinks",
                      "Study",
                    ].map((c) => (
                      <button
                        key={c}
                        className={category === c ? "active" : ""}
                        onClick={() => setCategory(c)}
                      >
                        {c || "All rooms"}
                      </button>
                    ))}
                  </div>
                  <div className="room-grid">
                    {rooms.map((r, i) => (
                      <article className={`room-card tone-${i % 4}`} key={r.id}>
                        <div className="room-card-top">
                          <span className="room-symbol">
                            {r.category === "Gaming"
                              ? "↗"
                              : r.category === "Food & Drinks"
                                ? "☕"
                                : r.category === "Study"
                                  ? "✎"
                                  : "✳"}
                          </span>
                          <span className="category">{r.category}</span>
                        </div>
                        <h3>{r.title}</h3>
                        <p>
                          {r.description ||
                            "A new room, a new conversation. Come say hello."}
                        </p>
                        <div className="tags">
                          {r.tags.slice(0, 3).map((t) => (
                            <span key={t}>#{t}</span>
                          ))}
                        </div>
                        <div className="room-meta">
                          <span>
                            <Radio size={14} />
                            {r.online} active
                          </span>
                          <span>
                            <Clock size={13} />
                            {r.region || "Anywhere"}
                          </span>
                        </div>
                        <button
                          className="join-button"
                          onClick={() =>
                            act(async () => {
                              await api(`/rooms/${r.id}/join`, "POST", {});
                              await openRoom(r.id);
                              await loadSocial();
                            })
                          }
                        >
                          Join the conversation <ArrowUpRight size={18} />
                        </button>
                      </article>
                    ))}
                  </div>
                  {!rooms.length && (
                    <div className="empty">
                      <Sparkles size={32} />
                      <h3>Start the conversation.</h3>
                      <p>
                        No rooms match right now. Create a room around a topic
                        you’d like to chat about.
                      </p>
                    </div>
                  )}
                  {feedNext && (
                    <button
                      className="button secondary"
                      onClick={() => act(() => loadRooms(true))}
                    >
                      More rooms
                    </button>
                  )}
                </>
              )}
            </section>
            <footer className="page-footer">
              <span>A room for right now.</span>
              <span>Temporary rooms · Hosted by you</span>
            </footer>
          </>
        )}
        {!active && page === "strangers" && (
          <section className="focus-page">
            <span className="pill">A FRESH START, EVERY TIME</span>
            <h1>
              Someone new.
              <br />
              <em>Something unexpected.</em>
            </h1>
            <p>
              Start a spontaneous one-to-one conversation. Your profile stays
              private until you choose to share. Conversations expire after they
              end.
            </p>
            <div className={`match-orb ${queue ? "searching" : ""}`}>
              <Shuffle size={50} />
            </div>
            <h2>
              {queue ? "Finding a conversation…" : "Ready for a quick chat?"}
            </h2>
            <p>No pressure. Leave, block or report whenever you need to.</p>
            {queue ? (
              <button
                className="button secondary"
                onClick={() =>
                  act(async () => {
                    await api("/match", "DELETE");
                    setQueue(false);
                  })
                }
              >
                Cancel search
              </button>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  user
                    ? act(async () => {
                        await heartbeat();
                        const r = await api("/match", "POST", {});
                        if (r.roomId) await openRoom(r.roomId);
                        else setQueue(true);
                      })
                    : setModal("guest")
                }
              >
                Meet someone <ArrowRight size={18} />
              </button>
            )}
          </section>
        )}
        {!active && page === "groups" && (
          <>
            <section className="rooms-home">
              <div className="section-title">
                <div>
                  <span className="eyebrow">FROM A LINK TO A CONVERSATION</span>
                  <h2>A little less organizing. A little more talking.</h2>
                </div>
              </div>
              <div className="room-steps">
                <article className="room-step">
                  <span className="step-icon">
                    <Plus size={22} />
                  </span>
                  <span className="step-number">01</span>
                  <h3>Make some room.</h3>
                  <p>
                    Give your chat a name and choose when it ends. No
                    participant list to put together.
                  </p>
                </article>
                <article className="room-step">
                  <span className="step-icon">
                    <Link size={22} />
                  </span>
                  <span className="step-number">02</span>
                  <h3>Send the link.</h3>
                  <p>
                    Drop the URL wherever your people are. Anyone with it can
                    join, including guests.
                  </p>
                </article>
                <article className="room-step">
                  <span className="step-icon">
                    <Shield size={22} />
                  </span>
                  <span className="step-number">03</span>
                  <h3>You’re the host.</h3>
                  <p>
                    Set the topic and pace, mute or remove participants, and
                    close the room whenever you’re done.
                  </p>
                </article>
              </div>
              <div className="section-title rooms-title">
                <div>
                  <span className="eyebrow">HERE FOR THE MOMENT</span>
                  <h2>
                    Your rooms <span className="live-dot" />
                  </h2>
                </div>
                <button className="text-button" onClick={startSharedRoom}>
                  Create a room <Plus size={16} />
                </button>
              </div>
              <div className="list">
                {conversations
                  .filter((r) => r.type === "SHARED_GROUP")
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => act(() => openRoom(r.id))}
                    >
                      <Link />
                      <span>
                        {r.title}
                        <small>
                          Expires {new Date(r.expires_at!).toLocaleString()}
                        </small>
                      </span>
                      <ArrowUpRight />
                    </button>
                  ))}
              </div>
              {!conversations.some((r) => r.type === "SHARED_GROUP") && (
                <div className="room-empty">
                  <span className="gate-icon">
                    <MessageCircle size={25} />
                  </span>
                  <div>
                    <h3>Good conversations start here.</h3>
                    <p>
                      A catch-up, a quick plan, a study session. Start a room
                      and let the link bring everyone together.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={startSharedRoom}
                  >
                    Create your first room <ArrowUpRight size={16} />
                  </button>
                </div>
              )}
              <p className="room-lifetime">
                <Clock size={14} /> Rooms close when their timer ends. Just
                enough space for the moment.
              </p>
            </section>
            <footer className="page-footer">
              <span>A link. A room. Your people.</span>
              <span>Temporary by design · Hosted by you</span>
            </footer>
          </>
        )}
        {!active && page === "contacts" && (
          <section className="content-page">
            <span className="eyebrow">MAKE THE HELLO LAST</span>
            <h1>
              Your connections<span className="accent">.</span>
            </h1>
            {!user?.verified ? (
              <div className="empty">
                <p>
                  Verify your email to save contacts and accept private chat
                  requests.
                </p>
                <button className="button" onClick={() => setModal("email")}>
                  Verify email
                </button>
              </div>
            ) : (
              <>
                <h2>
                  Requests <span className="count">{requests.length}</span>
                </h2>
                <div className="list">
                  {requests.map((r) => (
                    <div key={r.id}>
                      <span className="avatar">{r.display_name[0]}</span>
                      <span>
                        {r.display_name}
                        <small>{r.kind.toLowerCase()} request</small>
                      </span>
                      <button
                        className="button small"
                        onClick={() =>
                          act(async () => {
                            const result = await api(
                              `/requests/${r.id}/respond`,
                              "POST",
                              { accept: true },
                            );
                            await loadSocial();
                            if (result.roomId) await openRoom(result.roomId);
                          })
                        }
                      >
                        Accept
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            await api(`/requests/${r.id}/respond`, "POST", {
                              accept: false,
                            });
                            await loadSocial();
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  ))}
                </div>
                <h2>Saved contacts</h2>
                <div className="list">
                  {contacts.map((c) => (
                    <div key={c.id}>
                      <span className="avatar">{c.display_name[0]}</span>
                      <span>
                        {c.display_name}
                        <small>Mutually connected</small>
                      </span>
                      <button
                        className="text-button"
                        onClick={() => act(() => openRoom(c.room_id))}
                      >
                        Chat <MessageCircle size={16} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            await api(`/contacts/${c.id}`, "DELETE");
                            await loadSocial();
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {!contacts.length && (
                  <p className="muted">
                    Save someone after you’ve shared a conversation. They’ll
                    need to accept.
                  </p>
                )}
                <h2>
                  Meet again <span className="label">FREE FOR MVP</span>
                </h2>
                <div className="list">
                  {history.map((h) => (
                    <div key={h.id}>
                      <span>
                        {h.display_name}
                        <small>
                          Previously matched ·{" "}
                          {new Date(h.matched_at).toLocaleDateString()}
                        </small>
                      </span>
                      <button
                        className="text-button"
                        onClick={() => request(h.id, "RECONNECT")}
                      >
                        Request reconnect <ArrowUpRight size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {!active && page === "profile" && (
          <section className="content-page">
            <span className="eyebrow">YOU CHOOSE WHAT TO SHARE</span>
            <h1>
              Your little corner<span className="accent">.</span>
            </h1>
            {user ? (
              <>
                <div className="profile-status">
                  <span className="avatar large">{user.displayName[0]}</span>
                  <div>
                    <h2>{user.displayName}</h2>
                    <p>
                      {user.verified
                        ? "✓ Email verified"
                        : "Guest identity · temporary"}{" "}
                      {!user.verified && (
                        <button
                          className="text-button"
                          onClick={() => setModal("email")}
                        >
                          Verify & keep this identity
                        </button>
                      )}
                      {googleEnabled && (
                        <button
                          className="text-button"
                          onClick={() => setModal("email")}
                        >
                          Connect Google
                        </button>
                      )}
                    </p>
                  </div>
                </div>
                <form
                  className="profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.currentTarget;
                    act(async () => {
                      const r = await api("/me/profile", "PATCH", {
                        ...profileFromForm(f, user.profile),
                        region: field(f, "region"),
                        bio: field(f, "bio"),
                        interests: field(f, "interests")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        aslVisibility: field(f, "visibility"),
                      });
                      setUser(r);
                      notify("Profile saved.");
                    });
                  }}
                >
                  <JoinProfileFields profile={user.profile} />
                  <label>
                    Approximate region
                    <input
                      name="region"
                      placeholder="City or region only"
                      maxLength={80}
                      defaultValue={user.profile.region}
                    />
                  </label>
                  <label>
                    Interests, separated by commas
                    <input
                      name="interests"
                      defaultValue={user.profile.interests.join(", ")}
                    />
                  </label>
                  <label>
                    A little about you
                    <textarea
                      name="bio"
                      maxLength={300}
                      defaultValue={user.profile.bio}
                    />
                  </label>
                  <label>
                    Region visibility
                    <select
                      name="visibility"
                      defaultValue={user.profile.aslVisibility}
                    >
                      <option value="private">Private</option>
                      <option value="contacts_only">Contacts only</option>
                      <option value="public">
                        Share in rooms and after a quick chat
                      </option>
                    </select>
                  </label>
                  <p className="form-note">
                    Your email is never shown to other members. Share only an
                    approximate region.
                  </p>
                  <button className="button" disabled={busy}>
                    Save profile <Check size={16} />
                  </button>
                </form>
                <button
                  className="text-button"
                  onClick={() =>
                    act(async () => {
                      if (!("Notification" in window))
                        throw new Error(
                          "Notifications are not supported in this browser",
                        );
                      const result = await Notification.requestPermission();
                      notify(
                        result === "granted"
                          ? "Notifications enabled while Charoo is open."
                          : "Notifications were not enabled.",
                      );
                    })
                  }
                >
                  Enable browser notifications
                </button>
                <h2>Blocked members</h2>
                <div className="list">
                  {blocks.map((b) => (
                    <div key={b.target_id}>
                      <span>{b.display_name}</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            await api(`/blocks/${b.target_id}`, "DELETE");
                            await loadSocial();
                          })
                        }
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <button className="button" onClick={() => setModal("guest")}>
                Start as a guest
              </button>
            )}
          </section>
        )}
        {active && (
          <section className="chat">
            <div className="chat-head">
              <button
                className="button secondary small chat-back-button"
                aria-label="Back to rooms"
                onClick={() => choosePage(page)}
              >
                <ChevronLeft size={18} /> Back
              </button>
              <div>
                <h2>
                  {active.type === "STRANGER"
                    ? "Your next hello"
                    : active.title}
                </h2>
                <p>
                  {active.type === "STRANGER"
                    ? active.asl_revealed
                      ? "Profile sharing available · your preferences apply"
                      : "Identity hidden · get to know each other first"
                    : `${active.online} active · ${active.type === "SHARED_GROUP" ? "Room joined by link" : "Verified community"}`}
                  {isOwner && <span className="label">YOU’RE THE HOST</span>}
                </p>
              </div>
              {isOwner && active.type === "SHARED_GROUP" && (
                <button
                  className="button secondary small room-invite-button"
                  aria-label="Invite people to room"
                  title="Invite people to room"
                  disabled={busy}
                  onClick={openInvite}
                >
                  <Link size={18} />
                  <span>Invite people</span>
                </button>
              )}
              <button
                className="button secondary small room-leave-button"
                onClick={() =>
                  act(async () => {
                    await api(`/rooms/${active.id}/leave`, "POST", {});
                    setActive(null);
                    activeRef.current = null;
                    setMobileNav(false);
                    await loadSocial();
                  })
                }
              >
                Leave room
              </button>
            </div>
            <div className="chat-layout">
              <div className="chat-main">
                <div className="messages" aria-live="polite">
                  {messageNext && (
                    <button
                      className="text-button"
                      onClick={() =>
                        act(async () => {
                          const r = await api(
                            `/rooms/${active.id}/messages?before=${encodeURIComponent(messageNext)}`,
                          );
                          setMessages((prev) => [...r.messages, ...prev]);
                          setMessageNext(r.next);
                        })
                      }
                    >
                      Earlier messages
                    </button>
                  )}
                  <div className="chat-welcome">
                    <span className="room-symbol">✳</span>
                    <h3>You’re in. Make yourself at home.</h3>
                    <p>
                      {active.type === "SHARED_GROUP"
                        ? "One link brought you together. This room is here for the moment."
                        : "Say hello, be kind, and enjoy the conversation."}
                    </p>
                  </div>
                  {messages.map((m) => (
                    <div
                      className={`message ${m.senderId === user?.id ? "own" : ""}`}
                      key={m.id}
                    >
                      <span className="message-name">
                        {m.senderId === user?.id ? "You" : m.name}{" "}
                        <small>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </span>
                      {m.replyTo && (
                        <small className="reply-preview">
                          Replying to an earlier message
                        </small>
                      )}
                      <div className="message-bubble">
                        {m.text}
                        {m.attachmentId && (
                          <button
                            className="text-button"
                            onClick={() =>
                              act(async () => {
                                const r = await api(
                                  `/media/${m.attachmentId}/download`,
                                );
                                window.open(
                                  r.url,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              })
                            }
                          >
                            <Download size={15} />
                            Download scanned attachment
                          </button>
                        )}
                      </div>
                      <div className="message-tools">
                        {m.senderId === user?.id && (
                          <small>{m.readBy?.length ? "Seen" : "Sent"}</small>
                        )}
                        <button disabled={isMuted} onClick={() => setReply(m)}>
                          Reply
                        </button>
                        <button
                          disabled={isMuted}
                          onClick={() =>
                            act(async () => {
                              await api(
                                `/rooms/${active.id}/reactions`,
                                "POST",
                                {
                                  messageId: m.id,
                                  emoji: "❤️",
                                  remove:
                                    m.reactions["❤️"]?.includes(user!.id) ||
                                    false,
                                },
                              );
                              await refreshChat();
                            })
                          }
                        >
                          ♡ {m.reactions["❤️"]?.length || ""}
                        </button>
                        <button
                          onClick={() => {
                            setReply(m);
                            setModal("report");
                          }}
                        >
                          Report
                        </button>
                      </div>
                    </div>
                  ))}
                  {pending
                    .filter((p) => p.roomId === active.id)
                    .map((p) => (
                      <div
                        className="message own pending"
                        key={p.clientMessageId}
                      >
                        <div className="message-bubble">{p.text}</div>
                        <button
                          className="text-button"
                          disabled={isMuted}
                          onClick={() => act(() => submitMessage(p))}
                        >
                          Not confirmed · retry
                        </button>
                      </div>
                    ))}
                  {typing && <p className="typing">Someone is typing…</p>}
                  <div ref={chatEnd} />
                </div>
                <form className="composer" onSubmit={sendMessage}>
                  {isMuted && (
                    <div
                      className="mute-notice"
                      id="room-mute-notice"
                      role="status"
                    >
                      <Shield size={18} />
                      <div>
                        <strong>You’re muted by the host.</strong>
                        <span>
                          You can read the chat. You can send messages once the
                          host unmutes you or after{" "}
                          {new Date(active.mutedUntil).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          .
                        </span>
                      </div>
                    </div>
                  )}
                  {reply && (
                    <div className="reply-bar">
                      Replying to: {reply.text.slice(0, 80)}
                      <button
                        type="button"
                        onClick={() => setReply(null)}
                        aria-label="Cancel reply"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="composer-row">
                    <label
                      className="icon-button attachment"
                      title={
                        isMuted
                          ? "Attachments are disabled while muted"
                          : "Attach a file"
                      }
                    >
                      <Paperclip size={20} />
                      <input
                        type="file"
                        aria-label="Attach a file"
                        disabled={isMuted}
                        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/webm,audio/mpeg,application/pdf"
                        capture="environment"
                        onChange={(e) => {
                          if (e.target.files?.[0]) attach(e.target.files[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <input
                      aria-label="Message"
                      placeholder={
                        isMuted
                          ? "You are muted by the host"
                          : "Type a message…"
                      }
                      disabled={isMuted}
                      aria-describedby={
                        isMuted ? "room-mute-notice" : undefined
                      }
                      maxLength={4000}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (ws.current?.readyState === 1)
                          ws.current.send(
                            JSON.stringify({
                              type: "typing",
                              roomId: active.id,
                            }),
                          );
                      }}
                    />
                    <button
                      className="send"
                      aria-label="Send message"
                      disabled={isMuted || !draft.trim()}
                    >
                      <Send size={19} />
                      <span>Send</span>
                    </button>
                  </div>
                  <div className="composer-note">
                    <span>
                      {isMuted
                        ? "You can still read the conversation."
                        : "Press Enter to send."}
                    </span>
                    <button
                      type="button"
                      disabled={isMuted}
                      onClick={() =>
                        act(async () => {
                          const r = await api("/assistant", "POST", {
                            roomId: active.id,
                            style: "icebreaker",
                          });
                          setDraft(r.suggestion);
                        })
                      }
                    >
                      <Sparkles size={13} />
                      Need an icebreaker?
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>
        )}
        {!active &&
          page === "admin" &&
          user &&
          user.role !== "USER" &&
          admin && (
            <section className="content-page admin-page">
              <span className="eyebrow">CHAROO OPERATIONS</span>
              <h1>
                Community care<span className="accent">.</span>
              </h1>
              <div className="stats">
                {[
                  ["Accounts", admin.users],
                  ["Public rooms", admin.public_rooms],
                  ["Shared rooms", admin.shared_rooms],
                  ["Open reports", admin.reports],
                  ["Match queue", admin.queue],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <h2>Reports</h2>
              <div className="list">
                {adminReports.map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.reason}
                      <small>
                        {r.state} · {new Date(r.created_at).toLocaleString()}
                        <br />
                        User: {r.target_id || "—"} · Room: {r.room_id || "—"}
                      </small>
                    </span>
                    {user.role !== "SUPPORT" && r.message_id && (
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            const evidence = await api(
                              `/admin/reports/${r.id}/evidence`,
                            );
                            notify(
                              evidence.text || "Reported content has expired.",
                            );
                          })
                        }
                      >
                        View reported message
                      </button>
                    )}
                    {user.role !== "SUPPORT" && r.state === "OPEN" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            await api("/admin/actions", "POST", {
                              action: "RESOLVE_REPORT",
                              targetId: r.id,
                            });
                            await loadAdmin();
                          })
                        }
                      >
                        Resolve
                      </button>
                    )}
                    {user.role !== "SUPPORT" && r.target_id && (
                      <>
                        <button
                          className="text-button"
                          onClick={() =>
                            act(async () => {
                              await api("/admin/actions", "POST", {
                                action: "SUSPEND",
                                targetId: r.target_id,
                              });
                              await loadAdmin();
                            })
                          }
                        >
                          Suspend 24h
                        </button>
                        <button
                          className="danger small"
                          onClick={() =>
                            act(async () => {
                              await api("/admin/actions", "POST", {
                                action: "BAN",
                                targetId: r.target_id,
                              });
                              await loadAdmin();
                            })
                          }
                        >
                          Ban
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <h2>Rooms</h2>
              <div className="list">
                {adminRooms.map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.title}
                      <small>
                        {r.type} · {r.state}
                      </small>
                    </span>
                    {user.role !== "SUPPORT" && r.message_id && (
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            const evidence = await api(
                              `/admin/reports/${r.id}/evidence`,
                            );
                            notify(
                              evidence.text || "Reported content has expired.",
                            );
                          })
                        }
                      >
                        View reported message
                      </button>
                    )}
                    {user.role !== "SUPPORT" && r.state === "OPEN" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          act(async () => {
                            await api("/admin/actions", "POST", {
                              action: "CLOSE_ROOM",
                              targetId: r.id,
                            });
                            await loadAdmin();
                          })
                        }
                      >
                        Close
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {user.role === "ADMIN" && (
                <>
                  <h2>System settings</h2>
                  <form
                    className="settings-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(async () => {
                        const data = new FormData(e.currentTarget);
                        const cfg = Object.fromEntries(
                          Object.entries(admin.settings).map(([k, v]) => [
                            k,
                            typeof v === "boolean"
                              ? data.has(k)
                              : Number(data.get(k)),
                          ]),
                        );
                        await api("/admin/settings", "PATCH", cfg);
                        notify("Settings updated.");
                        await loadAdmin();
                      });
                    }}
                  >
                    {Object.entries(admin.settings).map(([k, v]) => (
                      <label key={k}>
                        {k.replaceAll("_", " ")}
                        {typeof v === "boolean" ? (
                          <input type="checkbox" name={k} defaultChecked={v} />
                        ) : (
                          <input
                            type="number"
                            name={k}
                            defaultValue={Number(v)}
                            readOnly={k === "reconnect_price"}
                          />
                        )}
                      </label>
                    ))}
                    <button className="button">Save settings</button>
                  </form>
                  <h2>Audit trail</h2>
                  <div className="list">
                    {audit.map((a) => (
                      <div key={a.id}>
                        <span>
                          {a.action}
                          <small>
                            {a.target_id} ·{" "}
                            {new Date(a.created_at).toLocaleString()}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
      </main>
      {!active && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {nav
            .filter(([p]) => p !== "admin")
            .map(([p, , icon]) => (
              <button
                key={p}
                className={page === p ? "selected" : ""}
                aria-current={page === p ? "page" : undefined}
                onClick={() => choosePage(p)}
              >
                <span className="mobile-nav-icon">
                  {icon}
                  {p === "contacts" && requests.length > 0 && (
                    <b className="mobile-nav-count">{requests.length}</b>
                  )}
                </span>
                <span>{mobileNavLabels[p]}</span>
              </button>
            ))}
        </nav>
      )}
      {calls.length > 0 && !callId && (
        <div className="call-invite">
          <Video />
          <div>
            {calls[0].state === "RINGING"
              ? `${calls[0].display_name} · video invitation`
              : "Your video call is ready"}
          </div>
          {calls[0].state === "ACCEPTED" ? (
            <button
              className="button small"
              onClick={() => setCallId(calls[0].id)}
            >
              Join call
            </button>
          ) : calls[0].target_id === user?.id ? (
            <>
              <button
                className="button small"
                onClick={() =>
                  act(async () => {
                    await api(`/calls/${calls[0].id}/respond`, "POST", {
                      accept: true,
                    });
                    await loadSocial();
                    setCallId(calls[0].id);
                  })
                }
              >
                Accept
              </button>
              <button
                className="text-button"
                onClick={() =>
                  act(async () => {
                    await api(`/calls/${calls[0].id}/respond`, "POST", {
                      accept: false,
                    });
                    await loadSocial();
                  })
                }
              >
                Decline
              </button>
            </>
          ) : (
            <button
              className="text-button"
              onClick={() =>
                act(async () => {
                  await api(`/calls/${calls[0].id}/end`, "POST", {});
                  await loadSocial();
                })
              }
            >
              Cancel
            </button>
          )}
        </div>
      )}
      {callId && (
        <Modal
          title="Private video call"
          onClose={() => notify("End the call to close this window.")}
        >
          <Suspense fallback={<p>Loading video…</p>}>
            <VideoCall
              callId={callId}
              onEnd={() => {
                setCallId(null);
                act(loadSocial);
              }}
              onError={(s) => notify(s, true)}
            />
          </Suspense>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <Flag size={17} /> : <Check size={17} />}
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal === "guest"
              ? hasRoomInvite
                ? "Join this room"
                : "A room starts with you"
              : modal === "email"
                ? "Sign in to Charoo"
                : modal === "joinProfile"
                  ? "Join this room"
                  : modal === "share"
                    ? "Your room is ready"
                    : modal === "invite"
                      ? "Invite people to your room"
                      : modal === "report"
                        ? "Help keep Charoo safe"
                        : modal === "editRoom"
                          ? "Your room, your topic"
                          : modal === "public"
                            ? "Start a public conversation"
                            : "Create your room"
          }
          onClose={() => {
            setModal(null);
            setCreateAfterGuest(false);
            if (modal === "report") setReply(null);
          }}
        >
          {googleEnabled && ["guest", "email"].includes(modal) && (
            <div className="google-sign-in">
              <button
                type="button"
                className="google-button"
                disabled={busy}
                onClick={signInWithGoogle}
              >
                <img src="/google-g.png" width={20} height={20} alt="" />
                Continue with Google
              </button>
              <p className="form-note">
                By continuing, you agree to be respectful and follow the host’s
                room rules.
              </p>
              <div className="auth-divider">
                <span>or</span>
              </div>
            </div>
          )}
          {modal === "guest" ? (
            <form onSubmit={startGuest}>
              <p>
                {hasRoomInvite
                  ? "Choose a nickname to join the invited room. You can sign in with Google or email to keep your identity."
                  : "Choose a nickname for your temporary guest identity. You can add your email later to keep it."}
              </p>
              <JoinProfileFields />
              <p className="form-note">
                Age and sex are optional and stay private unless you change your
                profile visibility.
              </p>
              <label className="checkbox">
                <input type="checkbox" required />I agree to be respectful and
                follow the host’s room rules.
              </label>
              <button className="button" disabled={busy}>
                Continue as guest <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setModal("email")}
              >
                Sign in with email instead
              </button>
            </form>
          ) : modal === "joinProfile" ? (
            <form onSubmit={completeJoinProfile}>
              <p>
                Confirm your nickname before entering the invited room. Age and
                sex are optional and follow your profile visibility setting.
              </p>
              <JoinProfileFields profile={user?.profile} />
              <button className="button" disabled={busy}>
                Join room <ArrowRight size={16} />
              </button>
            </form>
          ) : modal === "email" ? (
            <form onSubmit={email}>
              <p>
                We’ll email you a sign-in link. Keep your name and connections
                across visits, with no password to remember.
              </p>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
              <label className="checkbox">
                <input type="checkbox" required />I agree to be respectful and
                follow the host’s room rules.
              </label>
              <button className="button" disabled={busy}>
                Send my sign-in link <ArrowRight size={16} />
              </button>
              {!user && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setModal("guest")}
                >
                  Continue as guest instead
                </button>
              )}
            </form>
          ) : ["share", "invite"].includes(modal) ? (
            <>
              <p>
                Send this URL to bring everyone together. Anyone with the link
                can join unless you enabled email verification.
              </p>
              <input
                ref={shareLinkInput}
                readOnly
                value={shareUrl}
                aria-label="Secure room link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="button"
                onClick={() => copyInvite(shareUrl, shareLinkInput.current)}
              >
                Copy invite link <Link size={16} />
              </button>
              <p className="invite-copy-feedback" role="status">
                {inviteCopyMessage}
              </p>
              <p className="form-note">
                You’re the host and moderator. Save the link to invite more
                people before the room expires.
              </p>
            </>
          ) : modal === "report" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                act(async () => {
                  const r = await api("/reports", "POST", {
                    roomId: active?.id,
                    messageId: reply?.id,
                    targetId: reply?.senderId || peers[0]?.id,
                    reason: field(f, "reason"),
                  });
                  notify(r.message);
                  setModal(null);
                  setReply(null);
                });
              }}
            >
              <label>
                What happened?
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </label>
              <button className="button">
                Send report <Flag size={16} />
              </button>
            </form>
          ) : modal === "editRoom" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                act(async () => {
                  await api(`/rooms/${active.id}`, "PATCH", {
                    title: field(f, "title"),
                    description: field(f, "description"),
                    slowMode: Number(field(f, "slow")),
                  });
                  await refreshChat();
                  setModal(null);
                });
              }}
            >
              <label>
                Topic
                <input
                  name="title"
                  defaultValue={active.title}
                  required
                  minLength={3}
                  maxLength={100}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={active.description}
                  maxLength={500}
                />
              </label>
              <label>
                Seconds between messages
                <input
                  type="number"
                  name="slow"
                  min={0}
                  max={60}
                  defaultValue={active.slow_mode}
                />
              </label>
              <button className="button">Save changes</button>
            </form>
          ) : (
            <form onSubmit={createRoom}>
              <p>
                {modal === "public"
                  ? "Start a temporary public room around a topic you’d like to chat about."
                  : "Name your room, get a link, and send it around. You’ll be the host and moderator."}
              </p>
              <label>
                Room title
                <input
                  name="title"
                  placeholder="Weekend plans, study crew, quick catch-up…"
                  required
                  minLength={3}
                  maxLength={100}
                />
              </label>
              <label>
                A little more context (optional)
                <textarea
                  name="description"
                  placeholder="What’s the plan?"
                  maxLength={500}
                />
              </label>
              <div className="form-grid">
                {modal === "public" && (
                  <label>
                    Category
                    <select name="category">
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Ends in
                  <select name="duration" defaultValue="12">
                    <option value={3}>3 hours</option>
                    <option value={6}>6 hours</option>
                    <option value={12}>12 hours</option>
                    <option value={24}>24 hours</option>
                  </select>
                </label>
              </div>
              <details className="optional-settings">
                <summary>Optional room settings</summary>
                <label>
                  Approximate area (optional)
                  <input
                    name="region"
                    maxLength={80}
                    placeholder="Iloilo, or anywhere"
                  />
                </label>
                <label>
                  Tags (comma separated)
                  <input
                    name="tags"
                    placeholder="coffee, chill, conversation"
                  />
                </label>
                {modal === "shared" && (
                  <label className="checkbox">
                    <input type="checkbox" name="verified" />
                    Require email verification to join
                  </label>
                )}
              </details>
              <button className="button" disabled={busy}>
                {modal === "public" ? "Publish room" : "Create & get a link"}{" "}
                <ArrowUpRight size={17} />
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
