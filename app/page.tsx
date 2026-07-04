import EvidenceWorkbench from "@/components/EvidenceWorkbench";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Line by Line Lab</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Find reputable evidence. Cut debate-ready cards. In minutes.
        </p>
      </header>
      <EvidenceWorkbench />
    </main>
  );
}
