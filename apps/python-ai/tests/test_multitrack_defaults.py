from app.application.services.multitrack_service import _default_pitch_shift


def test_click_and_guide_do_not_pitch_shift_by_default() -> None:
    assert _default_pitch_shift("click") is False
    assert _default_pitch_shift("guide") is False
    assert _default_pitch_shift("drums") is True
    assert _default_pitch_shift("vocals") is True
