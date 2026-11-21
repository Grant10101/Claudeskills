# Claudeskills

Some claude skills that ive made or use.

Projects Claude works with through saved skills.

| Folder | What it is |
|---|---|
| [gesture-recorder/](gesture-recorder/) | Phone gesture recorder + repository of recorded gestures (one JSON file each). Skill: `gesture-recorder`. |
| [three-finger-crumple/](three-finger-crumple/) | Test ground: 3-finger pinch crumples a full-screen blue sheet, 3-finger expansion restores it. Detector compiled from recorded gestures. |
| [ponytail/](ponytail/) | Smallest-change coding mode, only on "be lazy" / "ponytail". From [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT). Skill: `ponytail`. |
| [security-audit/](security-audit/) | Codebase security review and full audits, incl. code on Cloudflare. From [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) (MIT). Skill: `security-audit`. |

## Where the gestures are

- Recorded on the phone in the Claude artifact **"Gesture Recorder"** (database collection `gestures`).
- Copied into this repo as `gesture-recorder/gestures/<id>.json` (catalog: `gesture-recorder/gestures/index.json`).
- Projects that use gestures keep their own copies in `<project>/gestures/`.

## Tests

```bash
pip install flask pytest
(cd gesture-recorder && pytest -q)
(cd three-finger-crumple && pytest -q)
```
