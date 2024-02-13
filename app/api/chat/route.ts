import { Database } from '@/lib/db_types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { cookies } from 'next/headers'
import { OpenAI } from 'openai'
import 'server-only'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000
})

export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })
  const json = await req.json()
  const { messages, previewToken } = json
  const userId = (await auth({ cookieStore }))?.user.id

  console.log('userId', userId, openai)

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  console.log('previewToken', messages)

  if (previewToken) {
    openai.apiKey = previewToken
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages,
    temperature: 0.7,
    stream: true
  })

  console.log('response', response)

  const stream = OpenAIStream(response, {
    async onCompletion(completion) {
      console.log('completion', completion)
      const title = json.messages[0].content.substring(0, 100)
      const id = json.id ?? nanoid()
      const createdAt = Date.now()
      const path = `/chat/${id}`
      const payload = {
        id,
        title,
        userId,
        createdAt,
        path,
        messages: [
          ...messages,
          {
            content: completion,
            role: 'assistant'
          }
        ]
      }
      // Insert chat into database.
      await supabase.from('chats').upsert({ id, payload }).throwOnError()
    }
  })

  return new StreamingTextResponse(stream)
}
