interface GitHubReleaseAsset {
  readonly name: string;
  readonly url: string;
}

function releaseCoordinates(url: URL): {
  owner: string;
  repository: string;
  tag: string;
  asset: string;
} | undefined {
  if (url.hostname !== "github.com") return undefined;
  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!match) return undefined;
  return {
    owner: decodeURIComponent(match[1]!),
    repository: decodeURIComponent(match[2]!),
    tag: decodeURIComponent(match[3]!),
    asset: decodeURIComponent(match[4]!),
  };
}

function headers(token: string, accept: string): HeadersInit {
  return {
    accept,
    authorization: `Bearer ${token}`,
    "user-agent": "Homi-Module-Distribution",
    "x-github-api-version": "2022-11-28",
  };
}

export async function fetchGitHubReleaseAsset(options: {
  readonly url: URL;
  readonly token?: string;
  readonly fetcher?: typeof fetch;
}): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const coordinates = releaseCoordinates(options.url);
  if (!options.token || !coordinates) {
    return fetcher(options.url, {
      redirect: "follow",
      headers: {
        accept: "application/octet-stream",
        ...(options.token
          ? { authorization: `Bearer ${options.token}` }
          : {}),
        "user-agent": "Homi-Module-Distribution",
      },
    });
  }

  const releaseUrl = new URL(
    `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/` +
      `${encodeURIComponent(coordinates.repository)}/releases/tags/` +
      encodeURIComponent(coordinates.tag),
  );
  const release = await fetcher(releaseUrl, {
    headers: headers(options.token, "application/vnd.github+json"),
  });
  if (!release.ok) return release;

  const body: unknown = await release.json();
  const assets =
    typeof body === "object" &&
    body !== null &&
    "assets" in body &&
    Array.isArray(body.assets)
      ? body.assets
      : [];
  const asset = assets.find(
    (candidate): candidate is GitHubReleaseAsset =>
      typeof candidate === "object" &&
      candidate !== null &&
      "name" in candidate &&
      candidate.name === coordinates.asset &&
      "url" in candidate &&
      typeof candidate.url === "string",
  );
  if (!asset) {
    return new Response("Release asset not found.", {
      status: 404,
      statusText: "Not Found",
    });
  }

  return fetcher(asset.url, {
    redirect: "follow",
    headers: headers(options.token, "application/octet-stream"),
  });
}
