# Troubleshooting & Issue Resolution

## 1. "Rate Exceeded" During Member Registration
**Issue:** You encounter a "Rate Exceeded" error when trying to register new members, or some users cannot sign up on certain days.
**Cause:** You are using the Supabase Free Tier, which enforces a strict limit of 30 emails per hour for Auth emails (like signup confirmations or password resets) to prevent spam.
**Is there a member limit?** The Supabase free tier allows up to **50,000 Monthly Active Users (MAUs)**. The limit is *not* on the number of members, but on the *rate of sending emails* without a custom SMTP provider.

### Solution 1: Disable Email Confirmations (Fastest for Internal Tools)
Since DramaConnect is often used as an internal platform where admins verify users manually (or users know the admins), you can turn off the email confirmation requirement. 
1. Go to your **Supabase Dashboard** -> **Authentication** -> **Providers**.
2. Click on **Email**.
3. Toggle OFF **Confirm email** and **Secure email change**.
4. Save the settings. 
*Result:* Members can now sign up instantly without waiting for an email, and the 30/hour rate limit will no longer block registrations.

### Solution 2: Use a Free Custom SMTP Provider (Best for Production)
If you want to keep email verifications enabled without rate limits:
1. Sign up for a free transactional email service like **Resend** (3,000 free emails/month) or **SendGrid**.
2. Generate SMTP credentials (Host, Port, Username, Password).
3. Go to **Supabase Dashboard** -> **Project Settings** -> **Authentication** -> **SMTP Settings**.
4. Enable Custom SMTP and enter the credentials. 
*Result:* Supabase will route emails through your provider, bypassing the strict 30/hour limit.

## 2. Using External Media Links (Google Drive & YouTube)
To save storage space on your 500MB free tier, we have added features to use external links for photos and videos instead of direct file uploads. 
*   **Profile Pictures:** Members can paste a Google Drive view link into their Profile page.
*   **Gallery:** Admins can paste Google Drive links (for photos) or YouTube links (for videos) directly into the Photo Gallery.

