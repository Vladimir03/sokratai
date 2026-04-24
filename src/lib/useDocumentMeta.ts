import { useEffect } from "react";

export interface DocumentMetaOptions {
  title: string;
  description: string;
  canonical: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  ogSiteName?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
}

function upsertMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function upsertCanonical(url: string) {
  let el = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", url);
}

export function useDocumentMeta(opts: DocumentMetaOptions) {
  useEffect(() => {
    document.title = opts.title;
    upsertMeta("name", "description", opts.description);
    upsertCanonical(opts.canonical);

    upsertMeta("property", "og:title", opts.ogTitle ?? opts.title);
    upsertMeta(
      "property",
      "og:description",
      opts.ogDescription ?? opts.description,
    );
    upsertMeta("property", "og:type", opts.ogType ?? "website");
    upsertMeta("property", "og:url", opts.ogUrl ?? opts.canonical);
    if (opts.ogSiteName) {
      upsertMeta("property", "og:site_name", opts.ogSiteName);
    }
    if (opts.ogImage) {
      upsertMeta("property", "og:image", opts.ogImage);
    }

    upsertMeta(
      "name",
      "twitter:title",
      opts.twitterTitle ?? opts.ogTitle ?? opts.title,
    );
    upsertMeta(
      "name",
      "twitter:description",
      opts.twitterDescription ?? opts.ogDescription ?? opts.description,
    );
    if (opts.twitterImage ?? opts.ogImage) {
      upsertMeta(
        "name",
        "twitter:image",
        (opts.twitterImage ?? opts.ogImage) as string,
      );
    }
  }, [
    opts.title,
    opts.description,
    opts.canonical,
    opts.ogTitle,
    opts.ogDescription,
    opts.ogImage,
    opts.ogUrl,
    opts.ogType,
    opts.ogSiteName,
    opts.twitterTitle,
    opts.twitterDescription,
    opts.twitterImage,
  ]);
}
