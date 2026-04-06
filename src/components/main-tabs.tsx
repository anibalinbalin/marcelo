"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function MainTabs({
  camilaContent,
  jpContent,
}: {
  camilaContent: ReactNode;
  jpContent: ReactNode;
}) {
  return (
    <Tabs defaultValue="camila">
      <TabsList variant="line">
        <TabsTrigger value="camila">Camila</TabsTrigger>
        <TabsTrigger value="jp">Juan Pablo</TabsTrigger>
      </TabsList>
      <TabsContent value="camila">{camilaContent}</TabsContent>
      <TabsContent value="jp">{jpContent}</TabsContent>
    </Tabs>
  );
}
