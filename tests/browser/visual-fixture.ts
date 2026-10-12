import type { BrowserContext } from "@playwright/test";
import { defaultSettings } from "@charoo/contracts";
export const visualIds = {
  user: "10000000-0000-4000-8000-000000000001",
  peer: "10000000-0000-4000-8000-000000000002",
  group: "20000000-0000-4000-8000-000000000001",
  contact: "20000000-0000-4000-8000-000000000002",
  public: "20000000-0000-4000-8000-000000000003",
};
export async function visualFixture(context: BrowserContext, signedIn = true) {
  await context.addInitScript(() => {
    class Socket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    (globalThis as any).WebSocket = Socket;
  });
  const profile = {
    displayName: "Cora Lane",
    age: 31,
    gender: "Woman",
    region: "Manila",
    bio: "Coffee, music, and good conversation.",
    interests: ["Coffee", "Music"],
    aslVisibility: "public",
  };
  const settings = {
    ...defaultSettings,
    video_enabled: true,
    AI_assistant_enabled: true,
  };
  const user = {
    id: visualIds.user,
    displayName: profile.displayName,
    verified: true,
    role: "ADMIN",
    profile,
    status: "Online",
  };
  const common = {
    description: "A little room for our favorite people.",
    category: "Conversation",
    region: "Manila",
    tags: ["coffee", "friends"],
    creator_id: user.id,
    expires_at: "2026-10-08T23:00:00.000Z",
    state: "OPEN",
    online: 2,
    verified_only: false,
    slow_mode: 2,
    created_at: "2026-10-08T08:00:00.000Z",
    last_activity: "2026-10-08T08:10:00.000Z",
    asl_revealed: false,
  };
  const group = {
    ...common,
    id: visualIds.group,
    type: "SHARED_GROUP",
    title: "Coffee with friends",
    shareUrl: `https://charoo.example/#room=${"a".repeat(43)}`,
  };
  const contact = {
    ...common,
    id: visualIds.contact,
    type: "CONTACT",
    title: "Private conversation",
    expires_at: null,
  };
  const publicRoom = {
    ...common,
    id: visualIds.public,
    type: "AVAILABLE_TONIGHT",
    title: "An evening catch-up",
    verified_only: true,
    online: 5,
  };
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    let response: any = {};
    if (path === "/api/auth/providers") response = { google: true };
    else if (path === "/api/me") {
      if (!signedIn)
        return route.fulfill({
          status: 401,
          json: { error: "Sign in to continue" },
        });
      response = { user, csrf: "visual-csrf", settings };
    } else if (path === "/api/presence")
      response = { status: "Online", availableExpires: false };
    else if (path === "/api/conversations") response = [group, contact];
    else if (path === "/api/rooms")
      response = { rooms: [publicRoom], next: null };
    else if (path === "/api/requests")
      response = [
        {
          id: "30000000-0000-4000-8000-000000000001",
          requester_id: visualIds.peer,
          target_id: user.id,
          display_name: "Milo Hart",
          kind: "PRIVATE",
          state: "PENDING",
          created_at: common.created_at,
        },
      ];
    else if (path === "/api/contacts")
      response = [
        { id: visualIds.peer, room_id: contact.id, display_name: "Milo Hart" },
      ];
    else if (path === "/api/reconnect")
      response = [
        {
          id: visualIds.peer,
          display_name: "Milo Hart",
          matched_at: common.created_at,
        },
      ];
    else if (path === "/api/blocks" || path === "/api/calls") response = [];
    else if (path === "/api/admin/dashboard")
      response = {
        users: 128,
        public_rooms: 8,
        shared_rooms: 12,
        reports: 2,
        queue: 3,
        settings,
        providers: { email: true, media: true, video: true, ai: true },
      };
    else if (path === "/api/admin/reports")
      response = [
        {
          id: "30000000-0000-4000-8000-000000000002",
          target_id: visualIds.peer,
          room_id: group.id,
          message_id: "40000000-0000-4000-8000-000000000001",
          reason: "Please review this message",
          state: "OPEN",
          created_at: common.created_at,
        },
      ];
    else if (path === "/api/admin/rooms") response = [group, publicRoom];
    else if (path === "/api/admin/audit")
      response = [
        {
          id: "audit",
          actor_id: user.id,
          action: "room.edit",
          target_id: group.id,
          details: {},
          created_at: common.created_at,
        },
      ];
    else if (/\/rooms\/[^/]+\/messages$/.test(path))
      response = {
        messages: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            roomId: group.id,
            senderId: visualIds.peer,
            name: "Milo Hart",
            text: "Who is up for coffee this afternoon?",
            createdAt: "2026-10-08T08:05:00.000Z",
            clientMessageId: "50000000-0000-4000-8000-000000000001",
            replyTo: null,
            attachmentId: null,
            reactions: { "❤️": [user.id] },
            readBy: [user.id],
          },
          {
            id: "40000000-0000-4000-8000-000000000002",
            roomId: group.id,
            senderId: user.id,
            name: user.displayName,
            text: "Count me in! Same place as last time?",
            createdAt: "2026-10-08T08:06:00.000Z",
            clientMessageId: "50000000-0000-4000-8000-000000000002",
            replyTo: null,
            attachmentId: null,
            reactions: {},
            readBy: [visualIds.peer],
          },
        ],
        next: null,
      };
    else if (/\/rooms\/[^/]+$/.test(path))
      response = {
        ...group,
        participants: [
          {
            id: user.id,
            name: user.displayName,
            verified: true,
            asl: { age: 31, gender: "Woman", region: "Manila" },
          },
          { id: visualIds.peer, name: "Milo Hart", verified: true, asl: null },
        ],
        aslProgress: [
          { id: user.id, count: 3 },
          { id: visualIds.peer, count: 4 },
        ],
      };
    else if (/\/rooms\/[^/]+\/invite$/.test(path))
      response = { shareUrl: group.shareUrl };
    else if (method !== "GET") return route.fulfill({ status: 204 });
    await route.fulfill({ json: response });
  });
}
