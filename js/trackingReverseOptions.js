// Record-page tracking direction flags (head position / rotation / face motion).

/**
 * @param {object} opts
 * @returns {{ reverseHeadPosition: boolean, reverseHeadRotation: boolean, reverseFaceMotion: boolean }}
 */
export function resolveTrackingReverse(opts = {}) {
  return {
    reverseHeadPosition:
      opts.reverseHeadPosition === true || opts.flipAlignX === true,
    reverseHeadRotation: opts.reverseHeadRotation === true,
    reverseFaceMotion: opts.reverseFaceMotion === true,
  };
}
