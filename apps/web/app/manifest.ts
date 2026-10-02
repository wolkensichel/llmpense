import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LLMpense",
    short_name: "LLMpense",
    description: "AI API cost and margin per client and project.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f4f1",
    theme_color: "#2d3aa8",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
