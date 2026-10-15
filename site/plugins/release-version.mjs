// Puts the version of the current Antimony release into the docs, so that install commands and download links can be
// copied as they are. Pages write %VERSION% where the version goes, in text, code and links.

const RELEASES_URL = 'https://api.github.com/repos/antimony-team/antimony/releases?per_page=30';
const PLACEHOLDER = /%VERSION%/g;

// Shown when there's no release, or GitHub can't be reached, e.g. offline in development. It replaces text in the MDX
// source, so it mustn't contain MDX syntax such as < or {.
const FALLBACK = 'x.y.z';

/**
 * Returns the version of the current release without the leading v: the latest stable release, or the newest
 * pre-release while there's no stable one. ANTIMONY_RELEASE overrides it.
 */
export async function getReleaseVersion() {
	if (process.env.ANTIMONY_RELEASE) return process.env.ANTIMONY_RELEASE.replace(/^v/, '');

	try {
		const headers = { Accept: 'application/vnd.github+json' };
		// CI passes its token, unauthenticated requests are limited to 60 per hour
		if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

		const response = await fetch(RELEASES_URL, { headers, signal: AbortSignal.timeout(10_000) });
		if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

		const releases = (await response.json()).filter((release) => !release.draft);
		const release = releases.find((release) => !release.prerelease) ?? releases[0];
		if (!release) throw new Error('there is no release yet');

		return release.tag_name.replace(/^v/, '');
	} catch (error) {
		console.warn(`[release-version] Using "${FALLBACK}" for %VERSION%: ${error.message}`);
		return FALLBACK;
	}
}

/** Vite plugin that replaces %VERSION% in the Markdown and MDX pages before they're compiled. */
export function releaseVersion(version) {
	return {
		name: 'antimony-release-version',
		enforce: 'pre',
		transform(code, id) {
			if (!/\.mdx?($|\?)/.test(id) || !code.includes('%VERSION%')) return null;
			return { code: code.replace(PLACEHOLDER, version), map: null };
		},
	};
}
