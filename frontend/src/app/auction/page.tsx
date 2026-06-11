import { Header } from "@/components/Header";
import { AuctionPage } from "@/components/AuctionPage";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Auctions — AlphBanX Mirror",
  description: "Live auction pools, active bids, and liquidation history for the AlphBanX lending protocol.",
};

export default function Auction() {
  return (
    <>
      <Header />
      <AuctionPage />
      <Footer />
    </>
  );
}
