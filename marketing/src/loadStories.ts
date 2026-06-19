import { staticFile } from "remotion";

export type Story = {
  id: string;
  epic: string;
  slice?: string;
  title: string;
  status?: string;
  complexity?: string;
  methodology?: string;
  depends_on?: string[];
  description?: string;
  acceptance_criteria?: string[];
  steps?: { id: string; agent?: string; description?: string }[];
};

export type EpicReplay = {
  epicId: string;
  stories: Story[];
};

export async function fetchEpic(epicId: string): Promise<EpicReplay> {
  const url = staticFile(`epics/${epicId}.json`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Epic '${epicId}' not baked. Run: npm run prebuild -- ${epicId}`,
    );
  }
  return (await res.json()) as EpicReplay;
}
