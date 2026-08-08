---
publish: false
---

# BlogsClub Check-in Helper

BlogsClub Check-in Helper is a userscript for checking your BlogsClub daily check-in status, reminding you when action is needed, and submitting the check-in after you complete the Geetest challenge.

The script does not solve, bypass, or automate the CAPTCHA. You must complete the challenge yourself.

## Features

- **Background status checks**: check whether today's check-in is complete at the configured interval and notify you when action is needed.
- **Manual check-in**: run an immediate check from the userscript menu, open the challenge when needed, and submit after you finish it.
- **Rush Check-in mode**: optionally prepare the challenge before server midnight and submit after the calibrated server midnight.
- **Ranking**: read today's ranking after a successful check-in and include it in the notification when available.
- **Server clock calibration**: estimate the offset between the BlogsClub server and local clock from the HTTP `Date` response header.
- **Fewer duplicate requests**: reuse valid sessions and in-flight requests on the current page without caching completed results.
- **Localized interface**: menus and notifications are available in English, Simplified Chinese, and Traditional Chinese; the first load follows the browser language preference and saves it.

## Supported Script Engines

The userscript supports [Tampermonkey](https://www.tampermonkey.net), [Violentmonkey](https://violentmonkey.github.io), [Greasemonkey](https://www.greasespot.net), [ScriptCat](https://docs.scriptcat.org), and other compatible userscript engines.

## Getting Started

1. Install a compatible userscript manager.
2. [Install the userscript directly from GitHub](https://github.com/HowieHz/howiehz-misc/raw/refs/heads/dist-userscript/blogsclub-signin-helper/blogsclub-signin-helper.user.js) or [install it from Greasy Fork](https://greasyfork.org/scripts/590073-blogsclub-check-in-helper).
3. Open `https://www.blogsclub.org/` or another BlogsClub page.
4. Open the userscript manager menu and choose `BlogsClub account: Not configured`.
5. Enter your BlogsClub email address and password.
6. The account status initially shows `Saved`. After a successful status check or login, it shows `Logged in`.
7. Choose `Check now / check in` to check immediately.

By default, automatic status checks run only on BlogsClub pages. Manual `Check now / check in` actions are available on any matched page.

## Menu and Settings

| Menu item                                                  | Default          | What it controls                                                                                                               |
| ---------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Check now / check in`                                     | —                | Check now. If you have not checked in, open the CAPTCHA and allow a manual check-in.                                           |
| `BlogsClub account: ...`                                   | `Not configured` | Save or update the email address and password.                                                                                 |
| `Check interval: 1000 ms`                                  | 1 second         | Background polling interval: how long to wait after one check request finishes before sending the next, from 1 ms to 24 hours. |
| `Automatic status checks only on BlogsClub pages: Enabled` | Enabled          | Restrict background polling and Rush Check-in to BlogsClub pages; manual checks are unrestricted.                              |
| `Auto CAPTCHA popup when check-in is available: Enabled`   | Enabled          | In normal mode, automatically open the CAPTCHA when polling finds that you have not checked in.                                |
| `Rush Check-in mode: Enabled`                              | Enabled          | Prepare the CAPTCHA before midnight and submit after the server's midnight.                                                    |
| `Rush Check-in CAPTCHA lead time: 5 seconds`               | 5 seconds        | Set how long before server midnight to start preparing the CAPTCHA; from 1 to 60 seconds.                                      |
| `Rush Check-in submission delay: 500 ms`                   | 500 ms           | Delay the first submission after server midnight; from 0 to 60000 ms.                                                          |
| `Rush Check-in submission retries: 50`                     | 50 retries       | Maximum retries while no success response has arrived; from 0 to JavaScript's maximum safe integer.                            |
| `Rush Check-in retry interval: 200 ms`                     | 200 ms           | Start each retry at this interval without waiting for the previous request; from 1 to 60000 ms.                                |

A high retry count combined with a short interval can send many concurrent requests in a short time. Set it according to the site's rate limits.

### Switch Language

The last menu item, `🌐 Switch language`, opens one input box: enter `1` for English, `2` for Simplified Chinese, or `3` for Traditional Chinese. On the first load, the script selects and saves a language from the browser preference; later loads use the saved choice.

### Account Status Labels

- `Not configured`: no complete email/password pair is stored.
- `Saved`: credentials are stored locally, but the password has not necessarily been verified.
- `Logged in`: the latest status check or login succeeded.
- `Login failed`: the latest login-required request failed. Common causes include a wrong password, an expired session, or a network error.

The password is stored in the userscript manager's local storage. It is not sent to the CAPTCHA provider; password login requests go only to the BlogsClub login endpoint.

## Normal Mode

Normal mode and Rush Check-in mode are on by default.

### Background Polling

The script calls the check-in status endpoint at the configured interval. With a valid session, it normally sends one `signinStatus` request. If the session is invalid or credentials were just changed, it logs in and checks the status again.

When polling finds that you have already checked in, it normally stays quiet. When it finds that you have not checked in, it sends at most one background notification per local calendar day. If automatic CAPTCHA popups are enabled, it also opens the challenge.

The next polling timer is scheduled after the previous check finishes. A slow request therefore pushes the next cycle back. Very short intervals create more traffic and may run into site rate limits.

### Manual Check

Clicking `Check now / check in` immediately shows `Checking check-in status…`.

- If the account is marked `Logged in`, the script reuses or sends `signinStatus` instead of logging in every time.
- If the session is invalid, it logs in and checks the status.
- If credentials were just saved or the account is marked `Login failed`, it validates the saved email and password.
- If you have not checked in, it opens the CAPTCHA.
- After you complete the challenge, it submits the check-in immediately.

The success notification includes the elapsed time. The script then requests the ranking data and user-center page in parallel to determine today's ranking. A ranking failure does not undo a successful check-in.

## Rush Check-in Mode

Rush Check-in mode is independent of the “automatic CAPTCHA popup” setting. Even when normal automatic popups are disabled, Rush Check-in can open its CAPTCHA when the mode is enabled and the page restriction allows it.

The flow is:

1. Request the BlogsClub login page and read its HTTP `Date` header to estimate the server clock offset.
2. Schedule the next server midnight using that calibrated clock.
3. At the configured lead time (five seconds by default) before server midnight, start loading the Geetest component and run `signinStatus` in parallel.
4. After the status/login preparation completes, show the CAPTCHA. A status result received before midnight belongs to the previous day and is not used to skip the new day's check-in.
5. If you finish the CAPTCHA before midnight, keep the validation result in memory.
6. At the configured submission delay after calibrated server midnight, send the first `action=signin` request.
7. While no success response has arrived, start retries at the configured interval, up to the configured retry count. Do not wait for the previous request; stop scheduling retries as soon as any response confirms a successful check-in.
8. If you finish after the target submission time, start the first submission immediately instead of waiting for an exact timestamp.

The timer checks whether the calibrated server time has reached the target. Browser throttling, system sleep, or network delay does not require the timer to fire at one exact millisecond.

Rush mode retries only within the configured count and time window. Multiple requests may be in flight at once. Once a success response arrives, no new request is started, but requests already sent cannot be withdrawn.

If another tab or client completes the check-in while Rush Check-in is waiting, this tab may still make one submission attempt and receive an “already checked in” response. Rush mode intentionally does not perform another status query immediately before submission.

## API and Network Activity

The script uses these BlogsClub endpoints:

| Request                                             | Purpose                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `GET https://www.blogsclub.org/login.html`          | Fetch the login token and read HTTP `Date` for clock calibration. |
| `POST /index.php/getLogin`                          | Log in with the saved email and password.                         |
| `POST /index.php/getProfile`, `action=signinStatus` | Check today's check-in status.                                    |
| `POST /index.php/getProfile`, `action=signin`       | Submit the Geetest validation and check in.                       |
| `POST /index.php/getProfile`, `action=signinRank`   | Fetch today's ranking data.                                       |
| `GET /usercenter.html`                              | Read the current user's `blog_id` for ranking matching.           |

These requests appear in your browser's Developer Tools Network panel. The Geetest widget also makes its own requests to `static.geetest.com`.

Within one page, the script shares only requests that are currently in flight: the login-page request and the check-in status flow. Each shared Promise is cleared when it settles. Completed results are not cached, and requests are not shared across tabs.

## Permissions and Local Data

The userscript declares these permissions:

- `GM_xmlhttpRequest`: cross-origin access to BlogsClub and Geetest resources;
- `GM_getValue` and `GM_setValue`: store credentials, settings, and the daily notification marker;
- `GM_registerMenuCommand` and `GM_unregisterMenuCommand`: register userscript menu items;
- `GM_notification`: send a userscript-manager or system notification;
- `unsafeWindow`: access the page's Geetest initialization function.

The exact appearance of `GM_notification` is controlled by the userscript manager and operating system.

Requests are non-anonymous and use the BlogsClub session cookies. Before uninstalling, clear this script's stored data in your userscript manager if you also want to remove the saved account information.

## Impact and Known Limitations

- By default, automatic status checks run only on BlogsClub pages. The script still matches other pages for its menu and manual checks.
- Each BlogsClub tab has its own polling and Rush Check-in timers. There is currently no cross-tab leader or lock, so multiple tabs may open multiple CAPTCHA windows and each run its configured submission retry sequence.
- If “Automatic status checks only on BlogsClub pages” is disabled, every matched page can run polling and Rush Check-in.
- Rush Check-in calibrates the clock from HTTP `Date`, but HTTP dates are usually only precise to the second. The submission-delay setting is approximate, not hard real-time scheduling guaranteed by the server.
- Clock offset correction does not discover the site's business timezone from HTTP `Date`. The midnight calendar uses the local timezone of the environment running the script. A browser timezone different from BlogsClub's business timezone can shift the Rush Check-in target.
- CAPTCHA completion is manual. If the challenge expires, fails, or the component cannot load, open it again and complete it.
- Ranking responses usually cover a limited range. If your account is outside the returned range, the message says it is not in the top 20. A ranking failure does not affect the check-in request itself.
- The userscript manager, browser throttling, system sleep, network quality, and site rate limits can all affect timing.

## Troubleshooting

### The status stays at “Saved”

`Saved` only means the credentials were written locally; it does not mean the password was verified. Click `Check now / check in` and check whether the status becomes `Logged in` or `Login failed`.

### No CAPTCHA appears

Automatic CAPTCHA popups and Rush Check-in are restricted by “Automatic status checks only on BlogsClub pages”; manual `Check now / check in` works on any matched page. Rush Check-in also waits for the configured preparation point before midnight.

### Multiple CAPTCHA windows appear

Usually, more than one BlogsClub tab is running. Close tabs you do not need, or temporarily disable Rush Check-in mode.

### No request appears in Developer Tools

With the default restriction enabled, ordinary webpages do not send automatic BlogsClub status requests; manual `Check now / check in` still sends one. Inspect automatic requests on a BlogsClub page, or disable “Automatic status checks only on BlogsClub pages”.

## Privacy and Security

This script stores your BlogsClub login email and password and uses them for automatic login. Verify that you trust the script source before installing it, and make sure you are comfortable with the credentials being used at the BlogsClub login endpoint. Do not upload or share a userscript-manager profile or storage directory that contains your local credentials.
