import { Header } from "@/components/Header";
import { AbxAbdPage } from "@/components/AbxAbdPage";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "ABX / ABD — AlphBanX Mirror",
  description: "Overview of ABX and ABD, the core tokens of the AlphBanX lending protocol.",
};

export default function Page() {
  return (
    <>
      <Header />
      <AbxAbdPage />
      <Footer />
    </>
  );
}
