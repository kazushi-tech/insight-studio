import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { AuthProvider } from '../../contexts/AuthContext'
import { RbacProvider } from '../../contexts/RbacContext'
import { ThemeProvider } from '../../contexts/ThemeContext'
import { AdsSetupProvider } from '../../contexts/AdsSetupContext'
import { ReportHistoryProvider } from '../../contexts/ReportHistoryContext'
import { AnalysisRunsProvider } from '../../contexts/AnalysisRunsContext'
import { BackendReadinessProvider } from '../../contexts/BackendReadinessContext'
import { UserProfileProvider } from '../../contexts/UserProfileContext'
import { server } from '../../test/mocks/server'

const QUESTION = '5月のPV数で一番高かった日はいつ？原因は何だと思う？'

const ANSWER_MARKDOWN = [
  '## 結論',
  '5月でPV数が最も高かったのは 2026-05-13 で、PV数は 401 です。',
  '',
  '## 数値根拠',
  '- 前日比は +102PV / +34.1% です。',
  '- 期間平均との差は +203.7PV / +103.2% です。',
  '',
  '## 原因として考えられること',
  'source / medium では google / organic、LP軸では厳密なセッションLP定義で https://www.petabit.co.jp/ から始まったセッション群の増加が目立ちます。',
  'campaign属性では (organic) が増えています。ただし、これは広告キャンペーン施策を意味するとは限らず、自然検索流入の増加として見るのが妥当です。',
  '',
  '## まだ断定できないこと',
  '広告配信、SNS投稿、メルマガ、外部露出の有無はこのデータだけでは確認できないため、原因は断定できません。',
  '',
  '## 次に確認すべきこと',
  '1. 最大日の source / medium 別PV',
  '2. 最大日の page_location 別PV',
  '3. 前週同曜日との比較',
  '',
  '## 打ち手',
  '自然検索で伸びたページの検索クエリと導線を確認し、同系統ページの内部リンクとCTAを優先改善してください。',
].join('\n')

function seedReadyStorage() {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('insight-studio-guide-seen', '1')
  localStorage.setItem('is_ads_token', 'test-token')
  localStorage.setItem('is_gemini_key', 'AIza-test-key')
  localStorage.setItem('is_user', JSON.stringify({ role: 'admin', display_name: 'テスト管理者' }))
  localStorage.setItem(
    'insight-studio-current-case',
    JSON.stringify({ case_id: 'petabit', name: 'ペタビット', dataset_id: 'analytics_311324674' }),
  )
  localStorage.setItem('insight-studio-case-authenticated', 'true')
  localStorage.setItem(
    'insight-studio-ads-setup:petabit',
    JSON.stringify({
      version: 3,
      queryTypes: ['pv', 'traffic', 'landing', 'device'],
      periods: ['2026-05'],
      granularity: 'monthly',
      datasetId: 'analytics_311324674',
      completedAt: '2026-05-24T00:00:00.000Z',
    }),
  )
}

function renderAppAt(initialPath = '/insights/ai') {
  window.history.pushState({}, '', initialPath)
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <RbacProvider>
            <UserProfileProvider>
              <AdsSetupProvider>
                <ReportHistoryProvider>
                  <BackendReadinessProvider>
                    <AnalysisRunsProvider>
                      <App />
                    </AnalysisRunsProvider>
                  </BackendReadinessProvider>
                </ReportHistoryProvider>
              </AdsSetupProvider>
            </UserProfileProvider>
          </RbacProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>,
  )
}

describe('/insights/ai neutral route AI Explorer', () => {
  beforeEach(() => {
    seedReadyStorage()
  })

  it('clears a legacy broken session, sends a question, displays answer_markdown, caveats, and restores safely', async () => {
    let neonCalls = 0
    let generateEndpointBody = null
    sessionStorage.setItem(
      'is-draft-ai-explorer',
      JSON.stringify({
        contextMode: 'ads-only',
        messages: [
          { role: 'user', text: QUESTION },
          { role: 'assistant', text: 'この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。' },
        ],
      }),
    )

    server.use(
      http.post('/api/ads/bq/generate_batch', () =>
        HttpResponse.json({
          report_md: '## PV分析\n2026-05-13 が 401PV で最大です。',
          chart_data: {
            groups: [
              {
                title: 'PV分析 — 日別推移',
                chartType: 'line',
                labels: ['2026-05-12', '2026-05-13'],
                datasets: [{ label: 'PV数', data: [299, 401] }],
              },
            ],
          },
        }),
      ),
      http.post('/api/insights/neon/generate', async ({ request }) => {
        neonCalls += 1
        generateEndpointBody = await request.json()
        return HttpResponse.json({
          ok: true,
          answer_markdown: ANSWER_MARKDOWN,
          text: ANSWER_MARKDOWN,
          direct_answer: '2026-05-13 が最大で、401PV です。',
          parse_status: 'json',
          fallback_used: false,
          caveats: [
            'セッションLPは user_pseudo_id + ga_session_id ごとの最初の page_view.page_location で定義しています。',
            'campaign属性の (organic) は広告キャンペーン施策名ではありません。',
          ],
          analysis_context: {
            dateRange: { start: '2026-05-01', end: '2026-05-31', timezone: 'Asia/Tokyo' },
            metricFocus: 'page_views',
            sessionLandingPageDiagnostic: {
              method: 'ga4_session_first_page_view',
              sessionKeyMethod: 'user_pseudo_id + ga_session_id',
              landingPageDefinition: 'first page_view.page_location in each GA4 session',
            },
            pvSpikePeak: {
              date: '2026-05-13',
              pageViews: 401,
              previousDayDelta: 102,
              previousDayDeltaRate: 34.1,
              periodAverageDelta: 203.7,
              periodAverageDeltaRate: 103.2,
            },
          },
        })
      }),
    )

    const user = userEvent.setup()
    const { unmount } = renderAppAt('/insights/ai')

    expect(await screen.findByText('古い形式の回答です')).toBeInTheDocument()
    expect(screen.queryByText('この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'セッションをクリア' }))

    const input = await screen.findByRole('textbox', { name: 'AIへの質問を入力' })
    await waitFor(() => expect(input).not.toBeDisabled())
    await user.type(input, QUESTION)
    await user.click(screen.getByRole('button', { name: '送信' }))

    expect(await screen.findByRole('heading', { name: '結論' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数値根拠' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '原因として考えられること' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'まだ断定できないこと' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '次に確認すべきこと' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '打ち手' })).toBeInTheDocument()
    expect(screen.getAllByText(/2026-05-13/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/401/).length).toBeGreaterThan(0)
    expect(screen.getByText(/JSON parse成功/)).toBeInTheDocument()
    expect(screen.getByText(/fallback/).closest('[data-testid="ai-response-meta"]')).toHaveTextContent('未使用')
    expect(screen.getByText(/GA4セッション内の最初のpage_view/)).toBeInTheDocument()
    expect(screen.getByText(/最初の page_view\.page_location/)).toBeInTheDocument()
    expect(screen.getByText(/広告キャンペーン施策名ではありません/)).toBeInTheDocument()
    expect(screen.getAllByText(/自然検索流入の増加として見るのが妥当/).length).toBeGreaterThan(0)
    expect(screen.queryByText('形式整形に失敗したため、AIの生回答を表示しています')).not.toBeInTheDocument()
    expect(screen.queryByText('この回答は表示形式を整えられませんでした。')).not.toBeInTheDocument()
    expect(neonCalls).toBe(1)
    expect(generateEndpointBody.message).toContain(QUESTION)

    await waitFor(() => {
      expect(sessionStorage.getItem('is-draft-ai-explorer')).toContain('2026-05-13')
    })

    unmount()
    renderAppAt('/insights/ai')

    expect(await screen.findByRole('heading', { name: '結論' })).toBeInTheDocument()
    expect(screen.getAllByText(/2026-05-13/).length).toBeGreaterThan(0)
    expect(screen.queryByText('この回答は表示形式を整えられませんでした。')).not.toBeInTheDocument()
  }, 15000)

  it('navigates from the sidebar AI link to /insights/ai', async () => {
    server.use(
      http.post('/api/ads/bq/generate_batch', () =>
        HttpResponse.json({
          report_md: '## PV分析\n2026-05-13 が 401PV で最大です。',
          chart_data: { groups: [] },
        }),
      ),
    )

    const user = userEvent.setup()
    renderAppAt('/')

    await user.click(await screen.findByRole('button', { name: /広告分析/ }))
    const aiLink = await screen.findByRole('link', { name: /AI考察/ })
    await user.click(aiLink)

    expect(window.location.pathname).toBe('/insights/ai')
    expect(await screen.findByTestId('ai-explorer-v2')).toBeInTheDocument()
  })

  it('keeps the legacy /ads/ai URL compatible by redirecting to /insights/ai', async () => {
    server.use(
      http.post('/api/ads/bq/generate_batch', () =>
        HttpResponse.json({
          report_md: '## PV分析\n2026-05-13 が 401PV で最大です。',
          chart_data: { groups: [] },
        }),
      ),
    )

    renderAppAt('/ads/ai?question=PV')

    await waitFor(() => expect(window.location.pathname).toBe('/insights/ai'))
    expect(window.location.search).toBe('?question=PV')
    expect(await screen.findByTestId('ai-explorer-v2')).toBeInTheDocument()
  })
})
