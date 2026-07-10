
/**
 * CÓDIGO FINAL PARA SUPABASE EDGE FUNCTION (Deno)
 * Nome: push-notifications
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

const VAPID_PUBLIC_KEY = "BAjzR0T971QRQTTcQxMMt4QmJcpBPZpRLWMRDiqAPgD2Jvs2dvfEkrz217PgqfLK2dOVmea-718DAv95d-7_MS0"
const VAPID_PRIVATE_KEY = "BemWL3eHdPV9NwYyUAMARSwJ5ezIiz5kPJZFfD9zFLE"

webpush.setVapidDetails(
  'mailto:contato@frutamina.com.br',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
)

serve(async (req) => {
  // Habilitar CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Tenta ler o corpo da requisição, mas não trava se falhar
    let userLabel = "Um usuário"
    try {
      const body = await req.json()
      // O Supabase Webhook envia o registro em body.record
      const record = body?.record || body
      if (record && record.user_email) {
        userLabel = record.user_email.split('@')[0]
      }
    } catch (e) {
      console.log("Sem payload JSON ou erro ao ler.")
    }

    // 1. Busca todas as assinaturas
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('subscription')

    if (error) throw error

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhuma assinatura encontrada." }), { status: 200 })
    }

    // 2. Prepara a mensagem
    const notificationPayload = JSON.stringify({
      title: "Estoque Atualizado",
      body: `O estoque do CD foi atualizado por ${userLabel}`,
      url: "./visao-geral.html"
    })

    // 3. Envia as notificações
    const results = await Promise.allSettled(
      subscriptions.map(sub => 
        webpush.sendNotification(sub.subscription, notificationPayload)
      )
    )

    return new Response(JSON.stringify({ 
      success: true, 
      total: subscriptions.length,
      results: results.map(r => r.status)
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 500,
    })
  }
})
