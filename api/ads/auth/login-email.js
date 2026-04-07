import { createHash, createHmac } from 'node:crypto'

function signJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  let users
  try {
    users = JSON.parse(process.env.AUTH_USERS || '[]')
  } catch {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const inputHash = createHash('sha256').update(password).digest('hex')
  const matched = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password_hash === inputHash,
  )

  if (!matched) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const token = signJwt(
    { user_id: matched.user_id, email: matched.email, role: matched.role },
    jwtSecret,
  )

  return res.status(200).json({
    token,
    user: {
      user_id: matched.user_id,
      email: matched.email,
      role: matched.role,
      display_name: matched.display_name,
    },
  })
}
