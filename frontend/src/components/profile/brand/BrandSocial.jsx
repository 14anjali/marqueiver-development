import SocialConnectCard from '../../SocialConnectCard';
import FacebookPages from '../FacebookPages';
import { Check } from '../../icons';
import { api } from '../../../lib/api';
import { SectionCard, followerCount } from '../shared';

/**
 * The brand's own social presence.
 *
 * Identical machinery to the creator section — the same OAuth, the same sync
 * and disconnect, the same multi-Page Facebook component — because it is the
 * same integration. What changed is underneath: every integration used to
 * mirror connected stats into `CreatorProfile` and nothing else, so a brand
 * could complete a connection, get a real `FacebookPage` row, and then see
 * nothing at all. `resolveSocialProfile` now resolves whichever profile the
 * user has, so a brand's figures land on `BrandProfile.socialAccounts`.
 *
 * Policy 13.1 lists social verification under Creators, so a connected account
 * does not contribute to a brand's verification level. It is presence, not
 * proof — which is why this section says so rather than showing a badge.
 */
export default function BrandSocial({ onChanged }) {
  return (
    <div className="space-y-5">
      <SectionCard
        title="Connected accounts"
        description="Show creators the audience your brand already reaches. Figures come from the accounts you connect, not from numbers typed in."
      >
        <div className="rounded-xl2 border border-brand-100 bg-gradient-to-r from-brand-50/70 to-pink-50/50 p-4">
          <p className="text-sm text-ink leading-relaxed">
            Connecting an account never lets Marqueiver post as you unless you ask for it. These
            figures are part of how your brand presents itself — they do not count toward brand
            verification, which is based on your company details.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Instagram"
        description="A Creator or Business account is required — that is a Meta requirement, not ours."
      >
        <SocialConnectCard
          platform="instagram"
          label="Instagram"
          successParam="ig"
          fetchProfile={api.instagramProfile}
          getAuthUrl={api.instagramAuthUrl}
          sync={api.instagramSync}
          disconnect={api.instagramDisconnect}
          onChange={onChanged}
          bare
          renderConnected={(ig) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1 truncate">
                @{ig.username} <Check className="w-4 h-4 text-jade-600 shrink-0" />
              </div>
              <div className="text-sm text-muted">
                <span className="tnum">{followerCount(ig.followers)}</span> followers ·{' '}
                {ig.mediaCount || 0} posts
              </div>
              {ig.lastSyncedAt && (
                <div className="text-[11px] text-muted mt-0.5">
                  Last synced {new Date(ig.lastSyncedAt).toLocaleString('en-IN')}
                </div>
              )}
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Facebook Pages"
        description="Connect every Page your brand runs. One of them represents you publicly; the rest are managed here."
      >
        <FacebookPages onChange={onChanged} />
      </SectionCard>

      <SectionCard title="YouTube">
        <SocialConnectCard
          platform="youtube"
          label="YouTube"
          successParam="yt"
          fetchProfile={api.youtubeProfile}
          getAuthUrl={api.youtubeAuthUrl}
          sync={api.youtubeSync}
          disconnect={api.disconnectYoutube}
          onChange={onChanged}
          bare
          renderConnected={(yt) => (
            <>
              <div className="font-semibold text-ink flex items-center gap-1 truncate">
                {yt.title} <Check className="w-4 h-4 text-jade-600 shrink-0" />
              </div>
              <div className="text-sm text-muted">
                <span className="tnum">{followerCount(yt.subscriberCount)}</span> subscribers ·{' '}
                {yt.videoCount || 0} videos
              </div>
              {yt.lastSyncedAt && (
                <div className="text-[11px] text-muted mt-0.5">
                  Last synced {new Date(yt.lastSyncedAt).toLocaleString('en-IN')}
                </div>
              )}
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Disconnect Facebook entirely"
        description="Removes every connected Page and the authorisation behind them. Individual Pages can be removed from their own card above."
      >
        <SocialConnectCard
          platform="facebook"
          label="Facebook"
          successParam="fb"
          fetchProfile={api.facebookProfile}
          disconnect={api.disconnectFacebook}
          onChange={onChanged}
          bare
          disconnectOnly
          renderConnected={(fb) => (
            <>
              <div className="font-semibold text-ink truncate">
                Authorised as {fb.facebookUserName || 'your Facebook account'}
              </div>
              <div className="text-sm text-muted">Disconnecting removes every Page at once.</div>
            </>
          )}
        />
      </SectionCard>
    </div>
  );
}