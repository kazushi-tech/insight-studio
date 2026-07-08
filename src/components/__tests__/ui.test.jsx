import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBanner } from '../ui'

describe('ErrorBanner', () => {
  it('shows recovery steps for retryable upstream errors', () => {
    render(
      <ErrorBanner
        message="分析バックエンドが一時的に応答できませんでした。"
        errorInfo={{
          category: 'upstream',
          label: 'バックエンドエラー',
          guidance: 'しばらく待って再試行してください。',
          retryable: true,
        }}
        onRetry={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('分析バックエンドが一時的に応答できませんでした。')
    expect(screen.getByLabelText('次に確認すること')).toHaveTextContent('同じ条件で再試行')
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument()
  })

  it('hides retry for non-retryable auth errors but keeps concrete guidance', () => {
    render(
      <ErrorBanner
        message="API キーが無効です。"
        errorInfo={{
          category: 'auth_error',
          label: '認証エラー',
          guidance: '設定を確認してください。',
          retryable: false,
        }}
        onRetry={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: '再試行' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('次に確認すること')).toHaveTextContent('設定画面で分析用APIキーを確認')
  })

  it('calls retry when retry is available', async () => {
    const onRetry = vi.fn()
    render(<ErrorBanner message="一時的な失敗" onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: '再試行' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
