import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VivaahMesh: Our Wedding",
    short_name: "Our Wedding",
    description: "One wedding plan for two families, each in their own language.",
    start_url: "/tg",
    display: "standalone",
    background_color: "#FBF6EC",
    theme_color: "#E8A317",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
