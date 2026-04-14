/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Ссылка для входа — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={logo}>Сократ</Text>
        <Heading style={h1}>Ссылка для входа</Heading>
        <Text style={text}>
          Нажмите кнопку ниже, чтобы войти в {siteName}. Ссылка действует ограниченное время.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Войти
        </Button>
        <Text style={footer}>
          Если вы не запрашивали эту ссылку, просто проигнорируйте это письмо.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '40px 25px' }
const logo = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: 'hsl(231, 36%, 29%)',
  margin: '0 0 24px',
  textAlign: 'center' as const,
}
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: 'hsl(220, 15%, 11%)',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const text = {
  fontSize: '14px',
  color: 'hsl(215, 16%, 47%)',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: 'hsl(231, 36%, 29%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '8px',
  padding: '12px 24px',
  textDecoration: 'none',
  display: 'block' as const,
  textAlign: 'center' as const,
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
