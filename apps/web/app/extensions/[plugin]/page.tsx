"use client";

import { useParams } from "next/navigation";
import ExtensionPage from "@/plugins/records/ExtensionPage";

export default function Page() {
  const { plugin } = useParams<{ plugin: string }>();
  return <ExtensionPage key={plugin} pluginId={plugin} />;
}
