
import { Car } from "@/services/cars";
import { LazyImage } from "@/components/ui/lazy-image";
import { Badge } from "@/components/ui/badge";

interface CarCardProps {
  car: Car;
  style?: React.CSSProperties; // Required for react-window
  onClick?: () => void;
}

export function CarCard({ car, style, onClick }: CarCardProps) {
  const coverPhoto = car.fotos && car.fotos.length > 0 ? car.fotos[0].url : '/placeholder-car.png';

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
  };

  return (
    <div 
      style={style} 
      className="p-2" // Padding for gutter
    >
        <div 
            className="group relative bg-white border rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer h-full flex flex-col overflow-hidden hover:border-blue-400"
            onClick={onClick}
        >
            {/* Image Section */}
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
                <LazyImage 
                    src={coverPhoto} 
                    alt={car.modelo} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                
                {/* Year Badge overlay */}
                <div className="absolute top-2 left-2">
                    <Badge variant="secondary" className="bg-white/90 text-xs font-semibold shadow-sm backdrop-blur-sm">
                        {car.ano}/{car.ano_modelo}
                    </Badge>
                </div>
            </div>

            {/* Content Section */}
            <div className="p-3 flex flex-col flex-1 gap-1">
                <div className="flex justify-between items-start gap-2">
                    <h3 className="font-semibold text-sm line-clamp-1 text-gray-900" title={car.modelo}>
                        {car.modelo}
                    </h3>
                </div>
                
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                    {car.marca} • {car.cor}
                </p>

                <div className="mt-auto pt-2 flex items-end justify-between border-t border-gray-50">
                    <div className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground uppercase">Preço</span>
                        <span className="font-bold text-blue-600 text-sm">{formatPrice(car.preco)}</span>
                    </div>
                    <div className="text-right">
                         <span className="text-[10px] text-muted-foreground">{car.km.toLocaleString()} km</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
