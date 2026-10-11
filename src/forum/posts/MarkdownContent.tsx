import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { ZoomImage } from "../motion/ZoomImage";

type MarkdownContentProps = {
  content: string;
  rich?: boolean;
};

export default function MarkdownContent({ content, rich = false }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={
        rich
          ? {
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer noopener">
                  {children}
                  <ExternalLink size={12} />
                </a>
              ),
              img: ({ alt, ...props }) => <ZoomImage {...props} alt={alt || "讨论图片"} />,
            }
          : undefined
      }
    >
      {content}
    </ReactMarkdown>
  );
}
