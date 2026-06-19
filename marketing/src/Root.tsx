import React from "react";
import { Composition } from "remotion";
import { StoryReplay, StoryReplayProps } from "./StoryReplay";
import { fetchEpic } from "./loadStories";

const FPS = 30;
const FRAMES_PER_STORY = 36;
const INTRO_FRAMES = 60;
const OUTRO_FRAMES = 60;
const DEFAULT_EPIC = "cwc-2026-integration";

export const Root: React.FC = () => {
  return (
    <Composition
      id="StoryReplay"
      component={StoryReplay}
      durationInFrames={INTRO_FRAMES + OUTRO_FRAMES + FRAMES_PER_STORY * 16}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ epicId: DEFAULT_EPIC } as StoryReplayProps}
      calculateMetadata={async ({ props }) => {
        const epic = await fetchEpic(props.epicId);
        const duration =
          INTRO_FRAMES +
          OUTRO_FRAMES +
          FRAMES_PER_STORY * Math.max(1, epic.stories.length);
        return {
          props: { ...props, epic },
          durationInFrames: duration,
        };
      }}
    />
  );
};
