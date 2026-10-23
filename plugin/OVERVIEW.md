Dispatches a pi coding agent into a GitHub Actions job for the repository of the workspace you are in, and tears that job down again.

A window is a throwaway GitHub Actions job that clones your repository, restores a paired Paseo daemon identity, and then waits to be steered from the app. This plugin is the start surface: it reads the repository from the workspace's git remote, dispatches the window workflow, and cancels the run when you are finished with it. The panel shows the repository it detected, the branch the agent's commits are pushed to, and every window run that has not finished.

Setup. The plugin runs `git` and `gh` on the daemon machine, so both must be installed and `gh` must be authenticated with a token that can dispatch workflows in the offload repository and cancel its runs. The window needs that repository's Actions secrets; the plugin reads none of them.

One window at a time. While a run is unfinished the plugin refuses a second dispatch, because two live windows sharing one daemon identity evict each other from the relay. Window slots and per-slot identities are not implemented here.
