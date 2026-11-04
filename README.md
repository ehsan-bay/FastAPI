# Salamat AI — light update (about 1 MB)

Code and web app only, applied on top of the installed image. No internet needed on the server
beyond fetching this branch. Data and settings are kept; a failed update rolls back automatically.

```bash
cd ~ && rm -rf salamat-update && git clone --depth 1 -b update-bundle https://github.com/ehsan-bay/FastAPI.git salamat-update && sudo bash salamat-update/update.sh
```
If the new version changes Python packages or AI models, the script says so and the full bundle
(branch `offline-bundle`) is needed once.
