'use client';

import { useEffect, useState } from "react";

export function LocalTime({ value }: { value: string | null }) {
  const [text, setText] = useState<string>("—");

  useEffect(() => {
    if (!value) {
      setText("—");
      return;
    }

    const date = new Date(value);
    setText(
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }).format(date),
    );
  }, [value]);

  return <time dateTime={value ?? undefined}>{text}</time>;
}
