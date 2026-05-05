import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Banner, BlockStack, Page, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export default function PricingBadgePage() {
  return (
    <Page title="Pricing badge test" subtitle="A/B test showing Shop Pay Installments text under the Add to Cart button.">
      <BlockStack gap="400">
        <Banner title="Coming soon" tone="info">
          <Text as="p" variant="bodySm">
            The pricing badge test will be set up once the theme liquid file is ready.
            Share the product section file and we will add the badge code and wire up the statistics here.
          </Text>
        </Banner>
      </BlockStack>
    </Page>
  );
}
