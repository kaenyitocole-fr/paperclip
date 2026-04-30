import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RejectFeedbackDialog({
  open,
  onOpenChange,
  subject,
  isPending = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string | null;
  isPending?: boolean;
  onSubmit: (decisionNote: string | undefined) => void;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) setNote("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            {subject
              ? `Send "${subject}" back to the agent with feedback.`
              : "Send this back to the agent with feedback."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="reject-feedback-note" className="text-xs font-medium text-muted-foreground">
            Changes requested (optional)
          </label>
          <Textarea
            id="reject-feedback-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={"- thing to change\n- another thing"}
            rows={6}
            disabled={isPending}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onSubmit(note.trim() ? note.trim() : undefined)}
            disabled={isPending}
          >
            {isPending ? "Sending..." : "Send back to agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
