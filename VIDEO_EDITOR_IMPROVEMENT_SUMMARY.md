# Summary: Video Editing Experience Improvements

## Goal

Improve the video editor experience in three main areas:

- Make video trimming smoother and more accurate when users drag the left or right timeline handle.
- Persist video speed changes so preview and export behavior stay consistent.
- Simplify the input panel to reduce vertical scrolling and keep the main controls visible on one screen.

## Decision 1: Optimize Video Trim Interaction

When users drag the left handle to the right or the right handle to the left, the timeline should respond close to realtime without visible lag.

Implementation direction:

- Update `startTime` and `endTime` while the user is dragging the trim handles.
- Seek the video preview to the current drag position so users can see the exact frame being trimmed.
- Show a timestamp tooltip above the active handle while dragging.
- Enforce a minimum distance between `startTime` and `endTime`, for example `0.2s`.
- Prevent the left handle from crossing the right handle, and prevent the right handle from crossing the left handle.
- Add light snapping to useful time markers such as `0.1s`, `1s`, the current playhead position, or keyframes if available.
- Optimize drag events with `requestAnimationFrame` or light throttling to avoid excessive state updates.
- Cache or lazy-render timeline thumbnails so dragging does not stutter.

Acceptance criteria:

- Dragging the left or right handle does not produce obvious lag.
- The preview seeks to the correct frame while dragging.
- The timestamp tooltip displays the correct time during drag.
- Users cannot create a clip shorter than the minimum duration.
- The exported result matches the trim range shown in the editor.

## Decision 2: Persist Speed Per Video Clip

Speed should not be treated as a temporary preview-only setting. The selected speed must be saved as part of each clip's state, project data, and export configuration.

Implementation direction:

- Add a `speed` or `playbackRate` field to the clip data model.
- When users change speed, update the state of the currently selected clip.
- When a project or clip is reopened, restore the saved speed.
- Apply the clip speed to video preview through `playbackRate`.
- Apply the same saved speed during export, not only in the UI.
- Add a reset action to restore speed to `1x`.
- Display the current speed in a readable format such as `0.5x`, `1x`, `1.25x`, or `2x`.
- If a clip is both trimmed and speed-adjusted, display duration based on the effective duration after speed is applied.

Acceptance criteria:

- After changing speed, switching clips and returning keeps the correct speed.
- Reloading the project restores the saved speed.
- Exported output speed matches the preview speed.
- Reset returns the clip speed to `1x`.
- Duration display remains understandable after both trimming and speed adjustment.

## Decision 3: Simplify Input Fields And Editing Panel

The editing panel should be reorganized so users do not need to scroll too much, especially when adjusting several values repeatedly.

Implementation direction:

- Group inputs by purpose: `Trim`, `Speed`, `Size`, `Position`, `Color`, and `Export`.
- Use a compact two-column grid on desktop for short fields such as width, height, x, y, start, and end.
- On mobile or narrow screens, use accordion or collapsible sections.
- Move less frequently used settings into an `Advanced` section.
- Use sliders or steppers for values that users adjust continuously, such as speed, opacity, volume, and radius.
- Shorten input labels while keeping clear context through layout, tooltips, or section labels.
- Keep important actions such as preview, trim, reset, and export easy to find.

Acceptance criteria:

- Main controls fit within one common desktop viewport.
- Vertical scrolling is reduced during video editing.
- Inputs do not overflow, overlap, or cause layout jumps.
- Mobile remains usable through collapsible sections.

## Decision 4: Upgrade The Color Picker Into A Multi-Purpose Control

The color picker should become a shared control for multiple color-related properties instead of relying on many separate inputs.

Implementation direction:

- Allow one color picker to edit multiple targets such as background, border, text, and shadow.
- Use tabs, a segmented control, or a dropdown to select the active color target.
- Support direct HEX/RGBA input.
- Support opacity editing inside the picker.
- Store recent colors so users can quickly reuse them.
- Add a project palette if needed.
- Support quick copy/paste of color values.
- Consider eyedropper support when the browser environment allows it.

Acceptance criteria:

- Users can edit multiple color targets from the same picker.
- Manually entered color values are validated and applied correctly.
- Opacity is saved with the color when alpha/RGBA is used.
- Recent colors display previously used values.

## Recommended Implementation Priority

1. Optimize trim handles and realtime preview seeking.
2. Persist speed per clip and synchronize preview/export behavior.
3. Reorganize the input panel into compact grouped sections.
4. Upgrade the color picker into a multi-purpose control.

## Technical Notes

- Consider extracting `trimRange`, `duration`, `effectiveDuration`, and `speed` calculations into dedicated helpers for easier testing.
- Add tests for edge cases such as nearly overlapping trim handles, speed below `1x`, speed above `1x`, state reload, and export after both trimming and speed adjustment.
- If the timeline renders thumbnails, cache thumbnail results instead of regenerating them during drag.
- During drag, prioritize lightweight UI updates; defer expensive calculations until drag end.
