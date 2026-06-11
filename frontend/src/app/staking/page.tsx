import { Header } from "@/components/Header";
import { StakingPage } from "@/components/StakingPage";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Staking — AlphBanX Mirror",
  description: "View all ABX staking positions, your staked tokens, and vesting locks.",
};

export default function Page() {
  return (
    <>
      <Header />
      <StakingPage />
      <Footer />
    </>
  );
}
