import { Eye, LockKeyhole } from "lucide-react";

export interface PictureSharing {
  eligible: boolean;
  self: {
    hasPicture: boolean;
    decision: "pending" | "declined" | "approved";
    pictureId?: string | null;
    previewUrl?: string | null;
  };
  participants: { id: string; url: string }[];
}

export function QuickChatDisclosure({
  userId,
  aslRevealed,
  progress,
  participants,
  sharing,
  busy,
  onDecision,
}: {
  userId: string;
  aslRevealed: boolean;
  progress: { id: string; count: number }[];
  participants: {
    id: string;
    asl?: { age: number | null; gender: string; region: string } | null;
  }[];
  sharing?: PictureSharing;
  busy: boolean;
  onDecision: (decision: "approved" | "declined", pictureId?: string) => void;
}) {
  const ownCount = progress.find((p) => p.id === userId)?.count || 0;
  const peerCount = progress.find((p) => p.id !== userId)?.count || 0;
  return (
    <div className="quick-chat-disclosure" aria-label="Quick chat sharing">
      <div className="disclosure-progress">
        <LockKeyhole size={16} aria-hidden="true" />
        <p>
          {aslRevealed
            ? "ASL milestone reached. Each person’s privacy preferences apply."
            : `ASL after 5 qualifying messages each · You ${Math.min(ownCount, 5)}/5 · Stranger ${Math.min(peerCount, 5)}/5`}
        </p>
      </div>
      {aslRevealed &&
        participants.map((person) => {
          const values = person.asl
            ? [
                person.asl.age ? `Age ${person.asl.age}` : "",
                person.asl.gender,
                person.asl.region,
              ].filter(Boolean)
            : [];
          return values.length ? (
            <p className="disclosure-asl" key={person.id}>
              <strong>{person.id === userId ? "You" : "Stranger"}:</strong>{" "}
              {values.join(" · ")}
            </p>
          ) : null;
        })}
      {!sharing?.eligible ? (
        <p className="disclosure-hint">
          Picture sharing becomes available after 10 qualifying messages each.
          Your picture stays hidden until you choose to share it.
        </p>
      ) : (
        <section
          className="picture-sharing-notice"
          aria-label="Profile picture sharing"
        >
          <p className="picture-sharing-milestone" role="status">
            <Eye size={17} aria-hidden="true" />
            <strong>Picture sharing is now available.</strong>
          </p>
          {!sharing.self.hasPicture ? (
            <p>
              You don’t have a profile picture to share. Your picture stays
              hidden.
            </p>
          ) : sharing.self.decision === "approved" ? (
            <p>You chose to show your profile picture in this chat.</p>
          ) : (
            <div className="picture-sharing-choice">
              {sharing.self.previewUrl && (
                <img
                  className="consent-picture-preview"
                  src={sharing.self.previewUrl}
                  alt="The profile picture you can choose to share"
                />
              )}
              <p>
                {sharing.self.decision === "declined"
                  ? "You can show your profile picture whenever you want."
                  : "Would you like to show your profile picture to this person? Only your picture will be shared, in this chat."}
              </p>
              <div className="picture-sharing-actions">
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  onClick={() =>
                    onDecision("approved", sharing.self.pictureId || undefined)
                  }
                >
                  Show my profile picture
                </button>
                {sharing.self.decision === "pending" && (
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => onDecision("declined")}
                  >
                    Not now
                  </button>
                )}
              </div>
            </div>
          )}
          {sharing.participants
            .filter((person) => person.id !== userId)
            .map((person) => (
              <figure className="shared-profile-picture" key={person.id}>
                <figcaption role="status">
                  Stranger chose to show you their profile picture.
                </figcaption>
                <img src={person.url} alt="Stranger’s shared profile picture" />
              </figure>
            ))}
        </section>
      )}
    </div>
  );
}
