"use client";

import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { TRADE_TOOL_NAMES, createClientTools, readSpokenResult } from "@/features/voice";
import type { VoiceToolName } from "@/features/voice";
import { callVoiceTool, loadVoiceSession } from "./voice-api";
import type { VoiceSessionResult } from "./voice-api";
import { describeParameters } from "./voice-transcript";
import type { NewTranscriptEntry, TranscriptEntry } from "./voice-transcript";
import { usePolling } from "./use-polling";
import styles from "./voice.module.css";

const AVAILABILITY_POLL_MS = 5000;
const SETUP_HINT = "Voice is not configured yet: add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID, then run npm run voice:setup-agent";

type Availability = { readonly kind: "checking" | "ready" } | Exclude<VoiceSessionResult, { readonly kind: "ready" }>;

interface VoicePanelProps {
  readonly onTrade: () => void;
}

export function VoicePanel(props: VoicePanelProps) {
  return (
    <ConversationProvider>
      <VoiceDesk {...props} />
    </ConversationProvider>
  );
}

function statusLabel(status: string, isSpeaking: boolean): string {
  if (status === "connecting") return "Connecting…";
  if (status === "connected") return isSpeaking ? "Agent is speaking" : "Listening";
  if (status === "error") return "Connection problem";
  return "Not connected";
}

function VoiceDesk({ onTrade }: VoicePanelProps) {
  const [availability, setAvailability] = useState<Availability>({ kind: "checking" });
  const [entries, setEntries] = useState<readonly TranscriptEntry[]>([]);
  const nextId = useRef(0);

  const append = (entry: NewTranscriptEntry) => {
    nextId.current += 1;
    const id = nextId.current;
    setEntries((current) => [...current, { ...entry, id }]);
  };

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      append({ kind: role === "user" ? "user" : "agent", text: message });
    },
    onError: (message) => {
      append({ kind: "notice", text: message });
    },
    onDisconnect: () => {
      append({ kind: "notice", text: "Conversation ended" });
    },
  });

  usePolling(() => {
    if (availability.kind === "ready") return;
    void loadVoiceSession().then((result) => {
      setAvailability(result.kind === "ready" ? { kind: "ready" } : result);
    });
  }, AVAILABILITY_POLL_MS);

  const forward = async (name: VoiceToolName, parameters: unknown): Promise<string> => {
    const raw = await callVoiceTool(name, parameters);
    const spoken = readSpokenResult(raw);
    append({ kind: "tool", tool: name, parameters: describeParameters(parameters), status: spoken?.status ?? "unreadable", say: spoken?.say ?? raw });
    if (TRADE_TOOL_NAMES.includes(name)) onTrade();
    return raw;
  };

  const start = () => {
    void loadVoiceSession().then((result) => {
      if (result.kind !== "ready") {
        setAvailability(result);
        return;
      }
      conversation.startSession({
        conversationToken: result.conversationToken,
        connectionType: "webrtc",
        clientTools: createClientTools(forward),
      });
    });
  };

  const live = conversation.status === "connected" || conversation.status === "connecting";
  const usable = availability.kind === "ready";

  return (
    <section className={styles.voicePanel} aria-labelledby="voice-heading">
      <h2 id="voice-heading" className={styles.voiceTitle}>Voice desk</h2>
      {availability.kind === "not-configured" ? (
        <p className={styles.voiceWarning} role="alert">
          {SETUP_HINT}
          {availability.missing.length > 0 ? ` (missing: ${availability.missing.join(", ")})` : ""}
        </p>
      ) : null}
      {availability.kind === "error" ? <p className={styles.voiceWarning} role="alert">{availability.message}</p> : null}
      <div className={styles.voiceBody}>
        <div className={styles.micColumn}>
          <button
            type="button"
            className={live ? styles.micLive : styles.micIdle}
            aria-pressed={live}
            aria-label={live ? "Stop talking to the desk" : "Start talking to the desk"}
            disabled={!usable && !live}
            onClick={live ? () => { conversation.endSession(); } : start}
          >
            {live ? "Stop" : "Mic"}
          </button>
          <p className={styles.voiceStatus} data-speaking={conversation.isSpeaking}>
            {statusLabel(conversation.status, conversation.isSpeaking)}
          </p>
          {conversation.status === "connected" ? (
            <button type="button" className={styles.muteButton} aria-pressed={conversation.isMuted} onClick={() => { conversation.setMuted(!conversation.isMuted); }}>
              {conversation.isMuted ? "Unmute mic" : "Mute mic"}
            </button>
          ) : null}
        </div>
        <ol className={styles.transcript} aria-label="Conversation transcript" aria-live="polite">
          {entries.length === 0 ? <li className={styles.transcriptEmpty}>Ask: “What’s the market saying about the Fed?”</li> : null}
          {entries.map((entry) => (
            <li key={entry.id} className={styles.line} data-kind={entry.kind}>
              {entry.kind === "tool" ? (
                <>
                  <span className={styles.toolCall}>{entry.tool} {entry.parameters}</span>
                  <span className={styles.toolResult} data-status={entry.status}>{entry.status}: {entry.say}</span>
                </>
              ) : (
                <>
                  <span className={styles.speaker}>{entry.kind === "user" ? "You" : entry.kind === "agent" ? "Desk" : "Note"}</span>
                  <span>{entry.text}</span>
                </>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
