"""Python precision-matting engine for Video Background Remover & Sprite Sheet Studio."""

from .matting import (  # noqa: F401
    KeyOptions,
    MattingOptions,
    coarse_alpha,
    detect_key_colors,
    refine_matte,
    remove_background,
)

__version__ = "1.0.0"
