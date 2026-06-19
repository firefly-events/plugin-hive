import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { brand } from "./brand";
import { EpicReplay, Story } from "./loadStories";

export type StoryReplayProps = {
  epicId: string;
  epic?: EpicReplay;
};

const INTRO_FRAMES = 60;
const FRAMES_PER_STORY = 36;

export const StoryReplay: React.FC<StoryReplayProps> = ({ epicId, epic }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  if (!epic) {
    return (
      <AbsoluteFill style={{ backgroundColor: brand.rokuPlum, color: brand.mothGold, padding: 64 }}>
        <div style={{ fontFamily: brand.headingFont, fontSize: 48 }}>
          No epic loaded. Pass `epicId` to StoryReplay.
        </div>
      </AbsoluteFill>
    );
  }

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 30], [40, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.rokuPlum,
        fontFamily: brand.headingFont,
        color: brand.whiteWine,
        padding: 64,
      }}
    >
      {/* corner brand mark */}
      <div
        style={{
          position: "absolute",
          top: 48,
          left: 64,
          fontSize: 24,
          color: brand.mothGold,
          letterSpacing: 4,
          textTransform: "uppercase",
        }}
      >
        Hive · Epic Replay
      </div>

      {/* epic title */}
      <div
        style={{
          marginTop: 96,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 700, color: brand.hiveWhite }}>{epic.epicId}</div>
        <div style={{ fontSize: 28, color: brand.mothGold, marginTop: 8 }}>
          {epic.stories.length} stories · planned to ship
        </div>
      </div>

      {/* story grid */}
      <div
        style={{
          marginTop: 56,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 20,
        }}
      >
        {epic.stories.map((story, i) => {
          const enter = INTRO_FRAMES + i * 6;
          const s = spring({
            fps,
            frame: frame - enter,
            config: { damping: 14, stiffness: 120 },
          });
          return (
            <StoryCard key={story.id ?? i} story={story} progress={s} index={i} />
          );
        })}
      </div>

      {/* progress bar */}
      <ProgressBar frame={frame} totalFrames={INTRO_FRAMES + epic.stories.length * FRAMES_PER_STORY + 60} />
    </AbsoluteFill>
  );
};

const StoryCard: React.FC<{ story: Story; progress: number; index: number }> = ({
  story,
  progress,
}) => {
  const opacity = progress;
  const translateY = (1 - progress) * 24;
  const scale = 0.94 + progress * 0.06;

  const acCount = story.acceptance_criteria?.length ?? 0;
  const agent = story.steps?.[0]?.agent ?? "—";
  const complexity = story.complexity ?? "—";

  return (
    <div
      style={{
        backgroundColor: brand.nightJar,
        borderRadius: 12,
        padding: 16,
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        borderLeft: `3px solid ${brand.mothGold}`,
        minHeight: 150,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: brand.mothGold,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {story.slice ?? story.id}
        </div>
        <div
          style={{
            fontSize: 16,
            color: brand.hiveWhite,
            lineHeight: 1.25,
            fontWeight: 600,
          }}
        >
          {story.title}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <Pill bg={brand.pixie} fg={brand.hiveWhite} label={agent} />
        <Pill bg={brand.rokuPlum} fg={brand.mothGold} label={complexity} />
        <Pill bg={brand.rokuPlum} fg={brand.whiteWine} label={`${acCount} AC`} />
      </div>
    </div>
  );
};

const Pill: React.FC<{ bg: string; fg: string; label: string }> = ({ bg, fg, label }) => (
  <span
    style={{
      backgroundColor: bg,
      color: fg,
      fontSize: 11,
      padding: "3px 10px",
      borderRadius: 999,
      letterSpacing: 1,
      textTransform: "uppercase",
      fontFamily: brand.monoFont,
    }}
  >
    {label}
  </span>
);

const ProgressBar: React.FC<{ frame: number; totalFrames: number }> = ({ frame, totalFrames }) => {
  const pct = interpolate(frame, [0, totalFrames], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        right: 64,
        bottom: 56,
        height: 4,
        backgroundColor: brand.nightJar,
        borderRadius: 2,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          backgroundColor: brand.mothGold,
          borderRadius: 2,
        }}
      />
    </div>
  );
};
