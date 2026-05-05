import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Banner, BlockStack, Card, InlineStack, Link, List, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export default function PricingBadgePage() {
  return (
    <Page
      title="Pricing badge"
      subtitle="Configure and verify the Shop Pay installments badge shown on product pages."
    >
      <BlockStack gap="400">
        <Banner title="Pricing badge is ready" tone="success">
          <Text as="p" variant="bodySm">
            The app block code is now implemented. Add the block to your product section in Theme Editor
            and publish the theme changes to show it on storefront.
          </Text>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Setup steps
            </Text>
            <List>
              <List.Item>Open Shopify Admin → Online Store → Themes → Customize.</List.Item>
              <List.Item>Open a product template where the badge should appear.</List.Item>
              <List.Item>
                Add app block <Text as="span" fontWeight="semibold">DML Shop Pay Badge</Text> in the product info section.
              </List.Item>
              <List.Item>Place it below the Add to cart button.</List.Item>
              <List.Item>Set installments, colors, and font size, then save/publish.</List.Item>
            </List>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Verification checklist
            </Text>
            <List>
              <List.Item>Badge appears on product pages with text and Shop Pay icon.</List.Item>
              <List.Item>Installment amount updates when variant changes.</List.Item>
              <List.Item>Currency/format follows your store money format.</List.Item>
            </List>
            <InlineStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                If it does not appear, confirm your product template includes app blocks and the block is enabled.
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Need help placing the block?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Share your product section/theme name and I can tailor exact placement instructions.
              You can also use{" "}
              <Link url="https://shopify.dev/docs/apps/online-store/theme-app-extensions" target="_blank" removeUnderline>
                Shopify theme app extension docs
              </Link>.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
