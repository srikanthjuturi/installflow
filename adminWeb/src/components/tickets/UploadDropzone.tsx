import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const ACCEPT = ".xlsx,.xls";
const MAX_ROWS = "5,000";

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  isUploading: boolean;
}

export function UploadDropzone({ onFile, isUploading }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const accept = (file?: File) => {
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) {
      setRejected(`${file.name} isn't a spreadsheet. Use the .xlsx template.`);
      return;
    }
    setRejected(null);
    onFile(file);
  };

  return (
    <div>
      {/* The input is the real control — the panel is its label, so click,
          keyboard and screen readers all reach the same thing. */}
      <input
        ref={inputRef}
        id="batch-file"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      <label
        htmlFor="batch-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-brand-500 bg-brand-100/40" : "border-line bg-surface-2",
        )}
      >
        <span className="bg-surface-3 text-ink-2 mb-3.5 grid size-12 place-items-center rounded-full">
          {isUploading ? <Spinner className="size-5" /> : <UploadCloud className="size-5" />}
        </span>
        <span className="text-sm font-semibold">
          {isUploading ? "Validating rows…" : "Drag & drop your .xlsx here"}
        </span>
        <span className="text-ink-3 mt-1 text-xs">
          or click to browse · max {MAX_ROWS} rows
        </span>
        <Button
          type="button"
          className="mt-4.5"
          disabled={isUploading}
          onClick={(e) => {
            e.preventDefault();
            inputRef.current?.click();
          }}
        >
          Select file
        </Button>
      </label>

      {rejected ? (
        <p role="alert" className="text-danger mt-2.5 text-xs">
          {rejected}
        </p>
      ) : null}
    </div>
  );
}
