import { useRef } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  Flag,
  Link,
  Shield,
  UserCheck,
  UserX,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Room, User } from "@charoo/contracts";

interface Member {
  id: string;
  name: string;
  verified: boolean;
  online?: boolean;
  mutedUntil?: string | null;
  asl: { age: number | null; gender: string; region: string } | null;
}
export function RoomSidebar({
  room,
  user,
  isOwner,
  busy,
  blocks,
  onBack,
  onClose,
  onInvite,
  onCopyInvite,
  onRequest,
  onModerate,
  onToggleBlock,
  onVideoInvite,
  onEditRoom,
  onReportRoom,
}: {
  room: Room & { participants: Member[] };
  user: User | null;
  isOwner: boolean;
  busy: boolean;
  blocks: { id: string }[];
  onBack: () => void;
  onClose: () => void;
  onInvite: () => void;
  onCopyInvite: (url: string, input: HTMLInputElement | null) => void;
  onRequest: (id: string, kind: string) => void;
  onModerate: (action: string, id?: string) => void;
  onToggleBlock: (id: string) => void;
  onVideoInvite: (id: string) => void;
  onEditRoom: () => void;
  onReportRoom: () => void;
}) {
  const inviteLink = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="room-sidebar-heading">
        <button className="button secondary" onClick={onBack}>
          <ChevronLeft size={18} /> Back to menu
        </button>
        <button
          className="icon-button sidebar-close"
          onClick={onClose}
          aria-label="Close room sidebar"
        >
          <X size={20} />
        </button>
      </div>
      <div className="room-sidebar-title">
        <span className="eyebrow">YOUR ROOM</span>
        <p className="room-sidebar-name">
          {room.type === "STRANGER" ? "Your next hello" : room.title}
        </p>
        <p>
          {room.participants.length} members · {room.online} online
        </p>
      </div>
      {isOwner && room.type === "SHARED_GROUP" && (
        <section className="room-invite-panel" aria-label="Room invitation">
          <button className="button small" disabled={busy} onClick={onInvite}>
            <Link size={16} /> Invite people
          </button>
          {room.shareUrl && (
            <div className="invite-link-field">
              <input
                ref={inviteLink}
                readOnly
                value={room.shareUrl}
                aria-label="Room invite link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="icon-button"
                aria-label="Copy room invite link"
                title="Copy room invite link"
                onClick={() => onCopyInvite(room.shareUrl!, inviteLink.current)}
              >
                <Copy size={17} />
              </button>
            </div>
          )}
          <p>
            {room.verified_only
              ? "People with this link need to sign in before joining."
              : "Anyone with the link can join this room."}
          </p>
        </section>
      )}
      <section className="room-members" aria-label="Room members">
        <h3>
          Members <span>{room.participants.length}</span>
        </h3>
        {room.participants.map((member) => {
          const muted = Boolean(
            member.mutedUntil && Date.parse(member.mutedUntil) > Date.now(),
          );
          const blocked = blocks.some((b) => b.id === member.id);
          return (
            <article
              className="participant"
              key={member.id}
              aria-label={`Member ${member.name}`}
            >
              <div>
                <span className="avatar">{member.name[0]}</span>
                <div className="member-identity">
                  <strong>
                    {member.name}
                    {member.id === user?.id && " (you)"}
                    {member.verified && (
                      <Check size={13} aria-label="Verified" />
                    )}
                  </strong>
                  <span className="member-presence">
                    <i className={member.online ? "online" : ""} />
                    {member.online ? "Online" : "Away"}
                  </span>
                </div>
              </div>
              <div className="member-badges">
                {member.id === room.creator_id && (
                  <span className="host-badge">
                    <Shield size={11} /> Host · moderator
                  </span>
                )}
                {muted && <span className="muted-badge">Muted</span>}
                {blocked && (
                  <span className="blocked-badge">Blocked by you</span>
                )}
              </div>
              {member.asl && (
                <p className="member-profile">
                  {[
                    member.asl.age ? `Age ${member.asl.age}` : "",
                    member.asl.gender,
                    member.asl.region,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {member.id !== user?.id && (
                <>
                  <div className="participant-actions">
                    {isOwner && (
                      <button
                        className={
                          muted ? "member-action active" : "member-action"
                        }
                        disabled={busy}
                        aria-label={`${muted ? "Unmute" : "Mute"} ${member.name}`}
                        onClick={() =>
                          onModerate(muted ? "UNMUTE" : "MUTE", member.id)
                        }
                      >
                        {muted ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        {muted ? "Unmute" : "Mute for 30 min"}
                      </button>
                    )}
                    <button
                      className={
                        blocked ? "member-action active" : "member-action"
                      }
                      disabled={busy}
                      aria-label={`${blocked ? "Unblock" : "Block"} ${member.name}`}
                      onClick={() => onToggleBlock(member.id)}
                    >
                      {blocked ? <UserCheck size={16} /> : <UserX size={16} />}
                      {blocked ? "Unblock" : "Block"}
                    </button>
                  </div>
                  {muted && isOwner && (
                    <p className="member-help">
                      Cannot send messages until you unmute them or 30 minutes
                      pass.
                    </p>
                  )}
                  {blocked && (
                    <p className="member-help">
                      Their messages are hidden from you. Unblock to see them
                      again.
                    </p>
                  )}
                  {(isOwner ||
                    (user?.verified && member.verified) ||
                    ["PRIVATE", "CONTACT", "STRANGER"].includes(room.type)) && (
                    <details className="member-more-actions">
                      <summary>More actions</summary>
                      {user?.verified && member.verified && (
                        <>
                          <button
                            disabled={busy || blocked}
                            onClick={() => onRequest(member.id, "PRIVATE")}
                          >
                            Request private chat
                          </button>
                          <button
                            disabled={busy || blocked}
                            onClick={() => onRequest(member.id, "CONTACT")}
                          >
                            Request to add contact
                          </button>
                        </>
                      )}
                      {["PRIVATE", "CONTACT", "STRANGER"].includes(
                        room.type,
                      ) && (
                        <button
                          disabled={busy || blocked}
                          onClick={() => onVideoInvite(member.id)}
                        >
                          <Video size={15} /> Invite to video call
                        </button>
                      )}
                      {isOwner && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => onModerate("REMOVE", member.id)}
                        >
                          Remove from room
                        </button>
                      )}
                    </details>
                  )}
                </>
              )}
            </article>
          );
        })}
        {room.participants.length >= 100 && (
          <p className="muted">Showing the first 100 members.</p>
        )}
      </section>
      {isOwner && (
        <section className="owner-controls" aria-label="Host controls">
          <h3>Host controls</h3>
          <p className="form-note">
            Mute stops a member from chatting. Block hides their messages from
            you.
          </p>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={onEditRoom}
          >
            Edit room & message pace
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => onModerate("CLOSE")}
          >
            Close room
          </button>
        </section>
      )}
      <button className="room-report-button" onClick={onReportRoom}>
        <Flag size={16} /> Report room
      </button>
    </>
  );
}
