import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, Icon } from "@/components/primitives";
import sadUrl from "@/assets/mascot/sad.png";
import exciteUrl from "@/assets/mascot/excite.png";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

type ToastProps = {
  open: boolean;
  message: string;
  onDismiss: () => void;
  action?: ToastAction;
  secondAction?: ToastAction;
  variant?: "error" | "info";
  /** ms before auto-dismiss; null disables. errors default manual, infos auto-dismiss. */
  durationMs?: number | null;
};

const DEFAULT_DURATION: Record<"error" | "info", number | null> = {
  error: null, // errors stay until dismissed
  info: 3500,
};

const EXIT_MS = 220;

export function Toast({
  open,
  message,
  onDismiss,
  action,
  secondAction,
  variant = "error",
  durationMs,
}: ToastProps) {
  const [leaving, setLeaving] = useState(false);

  const effectiveDuration =
    durationMs === undefined ? DEFAULT_DURATION[variant] : durationMs;

  useEffect(() => {
    if (!open) {
      setLeaving(false);
      return;
    }
    if (effectiveDuration == null) return;
    const timer = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(onDismiss, EXIT_MS);
    }, effectiveDuration);
    return () => window.clearTimeout(timer);
  }, [open, effectiveDuration, onDismiss]);

  if (!open) return null;
  const art = variant === "info" ? exciteUrl : sadUrl;

  const dismissWithExit = () => {
    setLeaving(true);
    window.setTimeout(onDismiss, EXIT_MS);
  };

  return (
    <div
      className={`mdv-toast mdv-toast--${variant}${leaving ? " is-leaving" : ""}`}
      role={variant === "error" ? "alert" : "status"}
    >
      <img
        src={art}
        alt=""
        aria-hidden
        width={28}
        height={28}
        draggable={false}
        className="mdv-toast__art"
      />
      <span className="mdv-toast__msg">{message}</span>
      {action ? (
        <button
          type="button"
          className="mdv-toast__action"
          onClick={() => {
            void action.onClick();
            dismissWithExit();
          }}
        >
          {action.label}
        </button>
      ) : null}
      {secondAction ? (
        <button
          type="button"
          className="mdv-toast__action"
          onClick={() => {
            void secondAction.onClick();
            dismissWithExit();
          }}
        >
          {secondAction.label}
        </button>
      ) : null}
      <Button
        className="mdv-toast__dismiss"
        title="dismiss"
        aria-label="dismiss"
        onClick={dismissWithExit}
        icon={<Icon icon={X} size={11} strokeWidth={1.5} />}
      />
    </div>
  );
}
