# Integrations

Instagram, Facebook, and Zoho are independent. One verified callback does not mark another channel live. Newly connected integration accounts start with automation paused.

## Instagram

Use Instagram API with Instagram Login for a professional account. Request `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. This connection does not require a linked Facebook Page.

Opening private replies use `recipient.comment_id` on the Instagram host. Later replies use the Instagram-scoped participant id returned by the provider. At most one opening per comment, within seven days. Further automation needs a user reply inside 24 hours of that reply.

Configure `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_INSTAGRAM_VERIFY_TOKEN`, and the public HTTPS callback `/api/webhooks/meta/instagram`. OAuth starts at `/api/oauth/instagram/start` with an expiring state bound to the staff session and workspace. Token exchange and live verification are pending until credentials exist.

## Facebook Page and Messenger

Connect a Page, not a personal profile. Planning permissions are `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_metadata`, and `pages_messaging`. Confirm the current endpoint requirements before App Review.

Subscribe `feed` for comment changes and `messages` for Messenger. A comment-author id is not a PSID. Ordinary replies wait for an authoritative participant id. Reels stay unsupported until a real Page reel comment and private reply are recorded. Groups, ads, and Live are out of V1.

Configure `META_FACEBOOK_APP_ID`, `META_FACEBOOK_APP_SECRET`, and `META_FACEBOOK_VERIFY_TOKEN`. The same Meta app may be recorded for both channels by using the same app id, or each channel can have its own app. The stored configuration is what the product uses.

## Zoho CRM

V1 targets the Leads module. Self Client is for the team's own organization. Server-based OAuth is for later client organizations. The accounts host and the returned `api_domain` must be on the allowlist (`accounts.zoho.*` and `www.zohoapis.com` plus the documented data-center hosts). Bangalore does not imply the `.in` data center.

Map the internal lead UUID to a unique external key when the organization has that field. Update by the stored CRM id after the first success. Do not match on Email or Phone by default. Phone and WhatsApp stay separate unless the person confirms they are the same number. A valid number is not treated as proof of ownership.

Seeds and tests write only to the in-memory simulation sink. Those ids look like `sim-crm-…` and are labelled Simulated in the UI.

## Readiness stamps

Each connection shows credential validation, scopes, webhook verification, account or Page subscription, and the last real comment or message as separate facts. Empty stamps stay empty. Simulation mode never fills the real-event stamp.
