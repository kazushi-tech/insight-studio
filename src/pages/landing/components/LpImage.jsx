import { useState } from 'react'

/**
 * LP用の画像コンポーネント。
 *
 * LPのモックアップ画像は外部CDN（Stitchエクスポート）の署名付きURLを参照しており、
 * URLが失効すると壊れた alt テキストが露出して高級感を損なう。読み込みに失敗した場合は
 * Botanical Green のブランドパネルへ graceful fallback し、レイアウトを保ったまま
 * 意図したプレースホルダに見せる。`src` が有効なら従来どおり実画像を表示する。
 */
export default function LpImage({ src, alt = '', className = '', icon = 'insights', ...rest }) {
  const [failed, setFailed] = useState(false)

  if (!failed && src) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        onError={() => setFailed(true)}
        {...rest}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={`${className} min-h-[150px] flex items-center justify-center bg-gradient-to-br from-primary via-primary to-primary-container`}
    >
      <span className="material-symbols-outlined text-5xl text-on-primary/70" aria-hidden="true">
        {icon}
      </span>
    </div>
  )
}
