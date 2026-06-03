export interface MdzipMarkdownRenderer {
  render(markdown: string, options?: Record<string, unknown>): string;
}

export interface MdzipAssetUrlResolver {
  resolveAssetUrl(path: string, fallbackDataUri?: string): string | undefined;
}

export interface MdzipRenderRequest {
  markdown: string;
  assetResolver?: MdzipAssetUrlResolver;
}

export interface MdzipRenderResult {
  html: string;
}

export class MdzipRenderingService {
  public constructor(private readonly renderer: MdzipMarkdownRenderer) {}

  public render(request: MdzipRenderRequest): MdzipRenderResult {
    return {
      html: this.renderer.render(request.markdown)
    };
  }
}

